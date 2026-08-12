import { Meteor } from "meteor/meteor";
import LineByLineReader from "line-by-line";
import path from "path";
import fs from "fs";
import zlib from "zlib"
import Permission from "../helper/Permission";
import downloadFile from "../helper/downloadFile";

Meteor.methods({
    async 'geneInfo.update'() {
        console.log("geneInfo.update");
        Permission.checkAdmin(this.userId)
        try {
            await DBCollections.GeneInfoTmp.rawCollection().drop()
            DBCollections.GeneInfoTmp.find({})
        } catch (e) {
            //do nothing
        }

        let geneInfoFile = path.join(Meteor.settings.private.tempDir, "gene_info.gz")
        await downloadFile("https://ftp.ncbi.nlm.nih.gov/gene/DATA/gene_info.gz", geneInfoFile)

        const lineReaderGeneInfo = new LineByLineReader(fs.createReadStream(geneInfoFile).pipe(zlib.createGunzip()))
        let count = 0
        let insertingDocs = [], bufferIdMap = []
        lineReaderGeneInfo.on('line', async (line) => {
            if (line[0] !== '#') {
                let [taxId, geneId, symbol, tmp, synonyms, tmp5, tmp6, tmp7, description] = line.split('\t')
                synonyms = [symbol, ...synonyms.split('|').filter(e => e !== "-")]

                let mapping = synonyms.map(e => ({
                    _id: geneId + "|" + e + "|Gene_Name|NCBI",
                    taxId,
                    from: geneId,
                    to: e,
                    type: "Gene_Name",
                    source: "NCBI"
                }))
                bufferIdMap.push(...mapping)

                insertingDocs.push({ _id: geneId, taxId, symbol, description })

                ++count
                if (count % 1000000 === 0) console.log("Read " + count + " lines")
                if (insertingDocs.length === 1000000) {
                    let tmp = insertingDocs;
                    insertingDocs = []

                    lineReaderGeneInfo.pause()
                    await DBCollections.GeneInfoTmp.rawCollection().insertMany(tmp)
                    lineReaderGeneInfo.resume()
                }

                // insert into EntrezIDMapping table
                if (bufferIdMap.length >= 1000000) {
                    let tmp = bufferIdMap;
                    bufferIdMap = []
                    try {
                        await DBCollections.EntrezIDMapping.rawCollection().insertMany(tmp, { ordered: false })
                    } catch (e) { }
                }
            }
        })
        lineReaderGeneInfo.on('end', async () => {
            console.log('Ending reading file')
            if (insertingDocs.length > 0) {
                await DBCollections.GeneInfoTmp.rawCollection().insertMany(insertingDocs)
            }
            // insert into EntrezIDMapping table
            if (bufferIdMap.length > 0) {
                try {
                    await DBCollections.EntrezIDMapping.rawCollection().insertMany(bufferIdMap, { ordered: false })
                } catch (e) { }
            }
            console.log('Started indexing')
            await Promise.all([
                DBCollections.GeneInfoTmp.createIndexAsync({ symbol: 1 }),
                DBCollections.GeneInfoTmp.createIndexAsync({ taxId: 1 }),
                DBCollections.GeneInfoTmp.createIndexAsync({ description: 1 })
            ])
            console.log('renaming')
            await DBCollections.GeneInfoTmp.rawCollection().rename("geneInfo", { dropTarget: true })

            // removing the file
            fs.unlinkSync(geneInfoFile)
            console.log("Done!")
        })
    },
    'geneInfo.count'({ taxId, symbol }) {
        return DBCollections.GeneInfo.find({
            taxId: taxId || undefined,
            symbol: symbol || undefined
        }).countAsync();
    },
    async 'geneInfo.fetch'({ skip, limit, taxId, symbol }) {
        return await DBCollections.GeneInfo.find({
            taxId: taxId || undefined,
            symbol: symbol || undefined
        }, { skip, limit }).fetchAsync();
    }
})