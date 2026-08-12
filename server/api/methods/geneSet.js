import { Meteor } from 'meteor/meteor'
import Permission from "../helper/Permission";
import geneSet from "../helper/geneSet";
import fs from "fs";
import path from "path";

let isGeneSetImporting = false;
Meteor.methods({
    async 'geneSet.add'({ organismId, databaseId, force = false }) {
        this.unblock()
        Permission.checkAdmin(this.userId)
        if (isGeneSetImporting) {
            throw new Meteor.Error("", "Importing is running");
        }
        isGeneSetImporting = true;
        try {
            // checking existing
            if (!force) {
                let existingData = !!await DBCollections.GeneSetAggregation.findOneAsync({ organism: organismId, database: databaseId })
                if (existingData) {
                    throw new Meteor.Error("", "The gene set is already exist.")
                }
            }
            // getting organism & database
            let organism = await DBCollections.Organism.findOneAsync(organismId)
            let database = await DBCollections.Database.findOneAsync(databaseId)
            let geneSets = []

            if (database.name === "KEGG") {
                // getting& inserting KEGG genesets
                geneSets = await geneSet.KEGG(organism.code)
            } else if (database.name === "GO") {
                console.log("adding go db")
                console.log("namespace", database.namespace)
                geneSets = await geneSet.GO(organism.code, database.namespace)
            } else if (database.name === "Reactome") {
                geneSets = await geneSet.Reactome(organism.code)
                console.log(organism.code)
                console.log({geneSets})
            } else if (database.name === "MitoCarta" && (organism.code === "hsa" || organism.code === "mmu")) {
                console.log("MitoCarta")
                geneSets = await geneSet.MitoCarta(organism.code)
            }

            if (!geneSets || !geneSets.length) {
                throw new Meteor.Error('', 'No gene set is found.')
            }

            for (let geneSet of geneSets) {
                await DBCollections.GeneSet.updateAsync({ database: databaseId, organism: organismId, id: geneSet.id }, {
                    $set: {
                        ...geneSet,
                        database: databaseId,
                        organism: organismId
                    }
                }, { upsert: true })
            }

            await DBCollections.GeneSetAggregation.updateAsync({ database: databaseId, organism: organismId }, {
                $set: {
                    organism: organism._id,
                    database: database._id,
                    count: geneSets.length
                }
            }, { upsert: true })
        }  catch (e) {
            throw e;
        } finally {
            isGeneSetImporting = false;
        }
    },
    'geneSet.remove'({ organismId, databaseId }) {
        Permission.checkAdmin(this.userId)
        DBCollections.GeneSet.removeAsync({ database: databaseId, organism: organismId })
        DBCollections.GeneSetAggregation.removeAsync({ database: databaseId, organism: organismId })
    },
    async 'geneSet.update'({ organismId, databaseId }) {
        Permission.checkAdmin(this.userId)
        await Meteor.callAsync("geneSet.add", { organismId, databaseId, force: true })
    },
    async 'geneSet.batchUpdate'({ organismIds, databaseId }) {
        Permission.checkAdmin(this.userId)
        for (let organismId of organismIds) {
            await Meteor.callAsync("geneSet.add", { organismId, databaseId, force: true })
            await new Promise(r => {
                setTimeout(r, 3000)
            })
        }
    },
    async 'geneSet.addAll'({ organismIds, databaseId }) {
        this.unblock()
        Permission.checkAdmin(this.userId)
        for (let organismId of organismIds) {
            try {
                console.log("adding ", organismId)
                await Meteor.callAsync("geneSet.add", { organismId, databaseId })
                await new Promise(r => {
                    setTimeout(r, 3000)
                })
            } catch (e) {
                // do nothing
            }
        }
    },
    async 'go.clearCache'() {
        Permission.checkAdmin(this.userId)
        try {
            const geneSetCachePath = path.join(Meteor.settings.private.tempDir, 'GoGeneSets.json')
            const termTemp = path.join(Meteor.settings.private.tempDir, 'go.obo')
            const geneTemp = path.join(Meteor.settings.private.tempDir, 'gene2go.gz')

            if (fs.existsSync(geneSetCachePath)) fs.unlinkSync(geneSetCachePath)
            if (fs.existsSync(termTemp)) fs.unlinkSync(termTemp)
            if (fs.existsSync(geneTemp)) fs.unlinkSync(geneTemp)

        } catch (e) {
            throw new Meteor.Error('', e.message)
        }
    },
    async 'geneSetsByOrganism'({ taxId, selectedDatasets }) {
        let organismId = (await DBCollections.Organism.findOneAsync({ taxId }))._id;
        // let databases = await DBCollections.Database.rawCollection().find({}).toArray();
        // filter by selected datasets

        let databases = await DBCollections.Database.rawCollection().find({ _id: { $in: selectedDatasets } }).toArray();
        return Promise.all(
            databases.map(async (database) => {
                database.geneSets = await DBCollections.GeneSet.rawCollection().find({ database: database._id, organism: organismId }).toArray()
                return database
            })
        )
    },

    async 'geneSet.getInfo'({ pathwayIds, genSetId, organismId }) {
        return await DBCollections.GeneSet.find({ id: { $in: pathwayIds }, database: genSetId, organism: organismId}).fetchAsync();
    },

    async 'geneSet.getByIds'({ ids }) {
        this.unblock();
        return await DBCollections.GeneSet.find({ id: { $in: ids } }).fetchAsync();
    }
});
