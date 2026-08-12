import {Meteor} from "meteor/meteor"
import rCommand from "/server/include/rCommand"
import Permission from "../helper/Permission";

Meteor.methods({
    async 'annotationDB.add'({sourcePackage, name, force = false}) {
        Permission.checkAdmin(this.userId)

        if (!force) {
            let existingData = !!await DBCollections.AnnotationDB.findOneAsync({source: sourcePackage})
            if (existingData) {
                throw new Meteor.Error("", `${name} is already exist.`)
            }
        }

        try {
            console.log(`${sourcePackage} is being added...`)
            let results = await rCommand.getAnnotationData(sourcePackage);
            let importedSamples = await results.res.flat().filter(e => e !== null);

            // insert into Temp Collection
            console.log("inserting into Temp Collection");
            let start = 0;
            let idTypes = new Set()
            while (start < importedSamples.length) {
                let end = start + 100000;
                let tmp = importedSamples.slice(start, end);
                start = end;
                // type of gene Id
                tmp.forEach(e => idTypes.add(e.type));

                // insert into EntrezIDMapping Collection
                try {
                    await DBCollections.EntrezIDMapping.rawCollection().insertMany(
                        await Promise.all(
                            tmp.map(async e => {
                                return {
                                    ...e, source: sourcePackage,
                                    _id: e.from + "|" + e.to + "|" + e.type + "|" + sourcePackage,
                                    taxId: await DBCollections.GeneInfo.findOneAsync({_id: e.from}).then(e => e?.taxId)
                                }
                            }, {ordered: false})
                        )
                    );
                } catch (e) {
                }
                console.log(`Inserted ${end} records`);
            }

            // upsert to id type
            console.log("upserting to IDType");
            for (let e of Array.from(idTypes)) {
                await DBCollections.IDType.upsertAsync({
                    name: e,
                    description: (!force) ? name.trim() : undefined,
                    source: sourcePackage
                }, {
                    $set: {
                        version: results.version
                    }
                })
            }
            // insert into annotationDB table
            console.log("inserting into annotationDB table");
            await DBCollections.AnnotationDB.upsertAsync({
                name: (!force) ? name.trim() : undefined,
                package: sourcePackage
            }, {
                $set: {
                    version: results.version
                }
            })
            console.log(`${sourcePackage} is added.`)

        } catch (e) {
            throw new Meteor.Error('', e.message);
        }
    },
    async 'annotationDB.update'({sourcePackage}) {
        await Meteor.callAsync("annotationDB.add", {sourcePackage, force: true})
    }
})

