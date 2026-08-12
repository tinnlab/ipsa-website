import {Meteor} from "meteor/meteor";
import LineByLineReader from "line-by-line";
import path from "path";
import fs from "fs";
import zlib from "zlib";
import Permission from "../helper/Permission";
import downloadFile from "../helper/downloadFile";
import {Random} from "meteor/random";
import {ObjectId} from "mongodb"
import _ from "lodash";
import Queue from "queue"

const lock = async () => {
    await DBCollections.IDMappingLogs.upsertAsync({type: "lock"}, {$set: {type: "lock", time: new Date()}})
}
const log = async (message) => {
    await lock()
    await DBCollections.IDMappingLogs.insertAsync({type: "message", time: new Date(), data: message})
}

let isUniprotIdMapping = false
Meteor.methods({
    async 'idMapping.uniprot.update'() {
        Permission.checkAdmin(this.userId)

        if (isUniprotIdMapping) {
            throw new Meteor.Error("", "Mapping Uniprot ID is running");
        }

        isUniprotIdMapping = true
        try {
            //in case id mapping is running on multiple instance and the server stops
            let lastUnLock = await DBCollections.IDMappingLogs.findOneAsync({type: "unlock"}, {sort: {time: -1}})
            if (!lastUnLock) {
                let lastLock = await DBCollections.IDMappingLogs.findOneAsync({type: "lock"}, {sort: {time: -1}})

                //if last lock is within 5 minutes
                if (lastLock && new Date(lastLock.time).getTime() > Date.now() - 1000 * 60 * 5) {
                    throw new Meteor.Error("", "ID Mapping updating is running on another server")
                }
            }

            await DBCollections.IDMappingLogs.rawCollection().deleteMany()

            try {
                await DBCollections.IDMappingTmp.rawCollection().drop()
                DBCollections.IDMappingTmp.find({})
            } catch (e) {
                //do nothing
            }

            await log("Downloading Uniprot ID mapping file")

            let uniprotFile = path.join(Meteor.settings.private.tempDir, "idmapping.dat.gz")
            if (!fs.existsSync(uniprotFile)) {
                await downloadFile("https://ftp.uniprot.org/pub/databases/uniprot/current_release/knowledgebase/idmapping/idmapping.dat.gz", uniprotFile)
            }

            let count = 0;
            let buffer = []
            let idTypes = new Set()

            const lineReader = new LineByLineReader(fs.createReadStream(uniprotFile).pipe(zlib.createGunzip()))
            const insertingQueueConcurrency = 10,
                insertingQueue = new Queue({concurrency: insertingQueueConcurrency, autostart: true})
            lineReader.on('line', async (line) => {

                let [from, type, to] = line.split('\t')
                buffer.push({from: from || Random.id(), to: to || Random.id(), type})
                idTypes.add(type)

                ++count;
                if (count % 100000 === 0) console.log(count)
                if (buffer.length >= 100000) {
                    const tmp = buffer
                    buffer = []

                    if (insertingQueue.length > insertingQueueConcurrency) {
                        lineReader.pause()
                        await new Promise(r => insertingQueue.once('success', r))
                    }

                    insertingQueue.push(async () => {
                        await DBCollections.IDMappingTmp.rawCollection().insertMany(tmp, {ordered: false})
                    })

                    console.log({insertingQueueLength: insertingQueue.length})

                    await DBCollections.IDMappingLogs.upsertAsync({id: "insert"}, {
                        $set: {id: "insert", type: "message", time: new Date(), data: "Inserted " + count + " records"}
                    })
                    lineReader.resume()
                }
            });

            lineReader.on('end', async () => {
                // await new Promise(r => insertingQueue.on('end', r))

                if (buffer.length > 0) {
                    await DBCollections.IDMappingTmp.rawCollection().insertMany(buffer, {ordered: false});

                    await DBCollections.IDMappingLogs.upsertAsync({id: "insert"}, {
                        $set: {id: "insert", type: "message", time: new Date(), data: "Inserted " + count + " records"}
                    })
                }
                await log("Building index. This operation can take some hours to a day");

                //Creating index can take very long time
                let lockInterval = setInterval(async () => {
                    lock()
                }, 1000 * 60 * 60 * 4) // lock every 4 minutes

                console.log("Creating index can take very long time")
                await Promise.all([
                    DBCollections.IDMappingTmp.createIndexAsync({from: 1}),
                    DBCollections.IDMappingTmp.createIndexAsync({type: 1}),
                    DBCollections.IDMappingTmp.createIndexAsync({to: 1})
                ])
                await log("Copying data to current collections");
                console.log("Copying data to current collections");
                await DBCollections.IDMappingTmp.rawCollection().rename("idMapping", {dropTarget: true})

                console.log("Inserting the Id types")
                try {
                    await DBCollections.IDType.rawCollection().insertMany(Array.from(idTypes).map(e => ({
                        name: e,
                        source: 'UNIPROT',
                        version: ''
                    })))
                } catch (e) {
                    // do nothing
                }
                console.log("Done")
                await log("Done")

                clearInterval(lockInterval)
                await DBCollections.IDMappingLogs.insertAsync({type: "unlock", time: new Date()})
                await DBCollections.IDMappingLogs.insertAsync({type: "done", time: new Date()})
            });
        } catch (e) {
            throw e;
        } finally {
            isUniprotIdMapping = false
        }
    },
    async 'idMapping.entrezID.update'() {
        Permission.checkAdmin(this.userId)
        // create temporary collection for id mapping with GeneID
        console.log("Creating temporary collection for id mapping with GeneID")
        await DBCollections.IDMapping.rawCollection().aggregate([
            { $match: { type: "GeneID" } },
            { $project: { _id: 0, from: 1, to: 1, type: 1 } },
            { $out: DBCollections.EntrezIDMappingTmp._name }
        ], { allowDiskUse: true }).toArray()

        // merge to entrezIdMapping collection
        console.log("Updating the entrezIdMapping table")
        await DBCollections.EntrezIDMappingLogs.upsertAsync({id: "start"}, {
            $set: {id: "start", type: "message", time: new Date()}
        })

        let limit = 10000, endId = 0, totalInserted = 0
        // get the first id of the collection
        const firstData = await DBCollections.EntrezIDMappingTmp.findOneAsync({}, {sort: {_id: 1}})
        if (firstData) {
            endId = new ObjectId(0)
        }
        // total number of records in the collection
        const total = await DBCollections.EntrezIDMappingTmp.find({}).countAsync()
        console.log("Total to process: ", total)

        while (totalInserted < total) {
            await DBCollections.EntrezIDMappingTmp.rawCollection().aggregate([
                {$match: {_id: {$gte: endId}}},
                {$sort: {_id: 1}},
                {$limit: limit},
                {
                    $lookup: {
                        from: DBCollections.IDMapping._name,
                        localField: "from",
                        foreignField: "from",
                        as: "map"
                    }
                },
                {$unwind: "$map"},
                {
                    $lookup: {
                        from: DBCollections.GeneInfo._name,
                        localField: "to",
                        foreignField: "_id",
                        as: "organism"
                    }
                },
                {$unwind: "$organism"},
                {
                    $project: {
                        from: "$to",
                        taxId: "$organism.taxId",
                        to: "$map.to",
                        type: "$map.type",
                        _id: {$concat: ["$to", "|", "$map.from", "|", "$map.type", "|", "UNIPROT"]},
                        source: "UNIPROT"
                    }
                },
                {
                    $merge: {
                        into: DBCollections.EntrezIDMapping._name,
                        on: "_id",
                        whenMatched: "replace",
                        whenNotMatched: "insert"
                    }
                }
            ], {allowDiskUse: true}).toArray()

            // increase the endId and total inserted number
            endId = await DBCollections.EntrezIDMappingTmp.rawCollection().aggregate([
                {$match: {_id: {$gte: endId}}},
                {$sort: {_id: 1}},
                {$limit: limit},
                {
                    $group: {
                        _id: null,
                        endId: {$max: "$_id"}
                    }
                }
            ]).toArray().then(e => e[0].endId)

            totalInserted += limit
            console.log("Inserted to entrezIdMapping " + totalInserted + " records")
            await DBCollections.EntrezIDMappingLogs.upsertAsync({id: "insert"}, {
                $set: {
                    id: "insert",
                    type: "message",
                    time: new Date(),
                    data: "Inserted " + totalInserted + " records"
                }
            })
        }
        // drop temporary collection
        try {
            await DBCollections.EntrezIDMappingTmp.rawCollection().drop()
        } catch (e) {
        }
        console.log("Done")
        await DBCollections.EntrezIDMappingLogs.upsertAsync({id: "done"}, {
            $set: {id: "done", type: "message", time: new Date()}
        })
    },
    async 'idMapping.getType'({ids, taxId}) {
        console.log("Getting types for ids", ids, taxId)
        let types = await DBCollections.EntrezIDMapping.rawCollection().aggregate([
            {
                $match: {to: {$in: ids}, taxId: taxId}
            },
            {
                $group: {
                    _id: "$type",
                    count: {
                        $sum: 1
                    }
                }
            },
            {
                $sort: {count: -1}
            }
        ], {allowDiskUse: true}).toArray()
        // types = types.map(e => e._id)
        return types.map(e => e._id)
    },
    async 'idMapping.getGeneIds'({ids, idType, taxId}) {
        const dat = await DBCollections.EntrezIDMapping.find({to: {$in: ids}, type: idType, taxId: taxId},
            {fields: {from: 1, _id: 0, to: 1}}).fetchAsync()
        return dat.reduce((acc, e) => acc.set(e.from, (acc.get(e.from) || []).concat(e.to)), new Map())
    }
})