import fetch from "node-fetch";
import _ from "lodash"
import {Meteor} from "meteor/meteor";
import zlib from "zlib";
import fs from "fs";
const fs_promise = require('fs').promises;
import path from "path";
import LineByLineReader from "line-by-line";
import downloadFile from "./downloadFile";
import {getMappedGeneIds} from "../methods/analysis";

let gene_set_by_tax_id = {}
export default {
    KEGG: async (code) => {
        try {
            console.log('adding KEGG ', code)
            let geneSet = await fetch(`http://rest.kegg.jp/link/${code}/pathway`);
            geneSet = await geneSet.text();
            geneSet = geneSet.split("\n").filter((e) => e.length);
            geneSet = geneSet.map((e) => ({
                name: e.split("\t")[0].trim(),
                gene: e.split("\t")[1].split(":")[1].trim(),
            }));

            // Convert gene IDs to ncbi-geneid type in batches of 200
            let genes = geneSet.map((e) => e.gene);
            let batches = [];

            for (let i = 0; i < genes.length; i += 50) {
                batches.push(genes.slice(i, i + 50));
            }

            let convertedGenes = [...genes]; // Initialize convertedGenes with original gene IDs

            // Check the first batch
            let firstBatch = batches[0];
            let apiUrl = `https://rest.kegg.jp/conv/ncbi-geneid/${firstBatch.map((gene) => `${code}:${gene}`).join("+")}`;
            let response = await fetch(apiUrl);
            let convertedBatch = await response.text();
            convertedBatch = convertedBatch.split("\n").filter((e) => e.length);
            let convertedFirstBatch = convertedBatch.map((e) => e.split("\t")[1].split(":")[1].trim());

            if (!_.isEqual(firstBatch, convertedFirstBatch)) {
                // If the converted IDs are different, proceed with converting the remaining batches
                console.log("Converted IDs are different. Proceeding with the remaining batches.");
                convertedGenes.splice(0, firstBatch.length, ...convertedFirstBatch);

                for (let i = 1; i < batches.length; i++) {
                    let batch = batches[i];
                    let apiUrl = `https://rest.kegg.jp/conv/ncbi-geneid/${batch.map((gene) => `cal:${gene}`).join("+")}`;
                    let response = await fetch(apiUrl);
                    let convertedBatch = await response.text();
                    convertedBatch = convertedBatch.split("\n").filter((e) => e.length);
                    let convertedBatchIds = convertedBatch.map((e) => e.split("\t")[1].split(":")[1].trim());
                    convertedGenes.splice(i * 200, batch.length, ...convertedBatchIds);
                }
            }

            geneSet = geneSet.map((e, index) => ({
                ...e,
                gene: convertedGenes[index],
            }));

            geneSet = _.chain(geneSet)
                .groupBy((e) => e.name)
                .map((value, key) => ({ key, value }))
                .value();

            let names = await fetch(`http://rest.kegg.jp/list/pathway/${code}`);
            names = await names.text();
            names = names.split("\n").filter((e) => e.length);

            let jsonNames = {};
            names.forEach((e) => {
                jsonNames[e.split("\t")[0].trim()] = e.split("\t")[1].trim();
            });

            return geneSet.map((e) => ({
                id: e.key,
                name: (jsonNames[e.key.replace("path:", "")] || "").split("-").slice(0, -1).join("-").trim(),
                genes: e.value.map((e) => e.gene),
            }));
        } catch (e) {
            throw new Meteor.Error("", e.message)
        }
    },
    GO: async (code, namespace) => {
        //Terms
        console.log('donwloading file')
        let termFile = path.join(Meteor.settings.private.tempDir, "go.obo")
        await downloadFile("http://purl.obolibrary.org/obo/go.obo", termFile)

        let terms = fs.readFileSync(termFile, "utf8").trim().split("[Term]").map(term => ({
            id: term.match(/id: (GO:[^\n]+)/)?.[1],
            name: term.match(/name: ([^\n]+)/)?.[1],
            namespace: term.match(/namespace: ([^\n]+)/)?.[1],
        })).filter(e => e.namespace === namespace).reduce((a, b) => {
            a[b.id] = b.name;
            return a
        }, {})
        console.log('here')
        let goGeneSetTempPath = path.join(Meteor.settings.private.tempDir, 'go_gene_set_tmp/')
        let organism = await DBCollections.Organism.findOneAsync({ code: code })
        let tax_id = organism.taxId

        let tax_id_path = path.join(goGeneSetTempPath, `temp_${tax_id}_${namespace}.csv`)
        console.log(tax_id_path)
        if (!fs.existsSync(tax_id_path)) {
            console.log("Not found organism")
            // fs.mkdir(goGeneSetTempPath, { recursive: true }, (err) => {
            //     if (err) throw err;
            // });
            //
            // //Gene set
            // const geneFile = path.join(Meteor.settings.private.tempDir, "gene2go.gz")
            // // await downloadFile("https://ftp.ncbi.nih.gov/gene/DATA/gene2go.gz", geneFile);
            //
            // const lineReaderGene = new LineByLineReader(fs.createReadStream(geneFile).pipe(zlib.createGunzip()))
            // let count = 0;
            // let taxId_array_by_batch = {}
            //
            // console.log(terms)
            // await new Promise(r => {
            //     lineReaderGene.on('line', async (line) => {
            //         let [taxId, geneId, goId] = line.split('\t')
            //         if (taxId && geneId && goId && terms[goId]) {
            //             if (!taxId_array_by_batch[taxId]) taxId_array_by_batch[taxId] = []
            //             taxId_array_by_batch[taxId].push(line.split('\t', 3).join("\t"))
            //             ++count;
            //             if (count%10000 === 0) {
            //                 console.log(count);
            //                 _.each( taxId_array_by_batch, async ( tax_data, tax_id ) => {
            //                     let tax_id_file_path = path.join(goGeneSetTempPath, `temp_${tax_id}_${namespace}.csv`)
            //                     await new Promise(r => {
            //                         const writeStream = fs.createWriteStream(tax_id_file_path, {flags:'a'})
            //                         tax_data.forEach((line) => {
            //                             writeStream.write(line + "\n")
            //                         })
            //                         r()
            //                     })
            //                 } );
            //                 taxId_array_by_batch = {}
            //             }
            //         }
            //     })
            //     lineReaderGene.on('end', async () => {
            //         await get_gene_set_from_file(tax_id_path, terms)
            //         r()
            //     })
            // })
        } else {
            await get_gene_set_from_file(tax_id_path, terms)
            console.log('Done processing')
        }
        // console.log(gene_set_by_tax_id)
        return Object.values(gene_set_by_tax_id)
    },
    // Reactome: async (code) => {
    //     console.log("Adding Reactome gene set")
    //     try {
    //         const reactomeFile = path.join(Meteor.settings.private.tempDir, "NCBI2Reactome_All_Levels.txt");
    //         await downloadFile("https://reactome.org/download/current/NCBI2Reactome_All_Levels.txt", reactomeFile);
    //
    //         const lineReader = new LineByLineReader(reactomeFile);
    //         const geneSetByPathway = {};
    //
    //         await new Promise((resolve) => {
    //             lineReader.on("line", (line) => {
    //                 const [geneId, pathwayId, _, pathwayName] = line.split("\t");
    //
    //                 if (pathwayId.includes(`-${code.toUpperCase()}-`)) {
    //                     if (!geneSetByPathway[pathwayId]) {
    //                         geneSetByPathway[pathwayId] = {
    //                             id: pathwayId,
    //                             name: pathwayName.trim(),
    //                             genes: new Set(), // Use a Set instead of an array
    //                         };
    //                     }
    //
    //                     // Check if geneId is a numeric string
    //                     if (/^\d+$/.test(geneId)) {
    //                         geneSetByPathway[pathwayId].genes.add(geneId); // Use add() method to add unique genes
    //                     } else {
    //                         console.warn(`Skipping non-numeric geneId: ${geneId}`);
    //                     }
    //                 }
    //             });
    //
    //             lineReader.on("end", () => {
    //                 resolve();
    //             });
    //         });
    //
    //         // Remove items from geneSetByPathway if genes set is empty
    //         Object.keys(geneSetByPathway).forEach((pathwayId) => {
    //             if (geneSetByPathway[pathwayId].genes.size === 0) {
    //                 delete geneSetByPathway[pathwayId];
    //             }
    //         });
    //
    //         // Check for duplicate gene sets and remove them
    //         const uniqueGeneSets = new Set();
    //         const uniquePathways = [];
    //
    //         Object.values(geneSetByPathway).forEach((pathway) => {
    //             const geneSetKey = Array.from(pathway.genes).sort().join(",");
    //             if (!uniqueGeneSets.has(geneSetKey)) {
    //                 uniqueGeneSets.add(geneSetKey);
    //                 uniquePathways.push({
    //                     ...pathway,
    //                     genes: Array.from(pathway.genes),
    //                 });
    //             }
    //         });
    //
    //         return uniquePathways;
    //     } catch (e) {
    //         throw new Meteor.Error("", e.message);
    //     }
    // },
    Reactome: async (code) => {
        console.log("Adding Reactome gene set");
        try {
            const reactomeFile = path.join(Meteor.settings.private.tempDir, "NCBI2Reactome_All_Levels.txt");

            // Check if the file already exists
            let fileExists = false;
            try {
                await fs_promise.stat(reactomeFile);
                fileExists = true;
                console.log("NCBI2Reactome_All_Levels.txt already exists, skipping download");
            } catch (err) {
                console.log("NCBI2Reactome_All_Levels.txt not found, downloading...");
            }

            if (!fileExists) {
                await downloadFile("https://reactome.org/download/current/NCBI2Reactome_All_Levels.txt", reactomeFile);
                console.log("Download completed");
            }

            const lineReader = new LineByLineReader(reactomeFile);
            const geneSetByPathway = {};

            await new Promise((resolve) => {
                lineReader.on("line", (line) => {
                    const [geneId, pathwayId, _, pathwayName] = line.split("\t");

                    if (pathwayId.includes(`-${code.toUpperCase()}-`)) {
                        if (!geneSetByPathway[pathwayId]) {
                            geneSetByPathway[pathwayId] = {
                                id: pathwayId,
                                name: pathwayName.trim(),
                                genes: new Set(),
                            };
                        }

                        // Check if geneId is a numeric string
                        if (/^\d+$/.test(geneId)) {
                            geneSetByPathway[pathwayId].genes.add(geneId);
                        } else {
                            console.warn(`Skipping non-numeric geneId: ${geneId}`);
                        }
                    }
                });

                lineReader.on("end", () => {
                    resolve();
                });
            });

            // Remove items from geneSetByPathway if genes set is empty
            Object.keys(geneSetByPathway).forEach((pathwayId) => {
                if (geneSetByPathway[pathwayId].genes.size === 0) {
                    delete geneSetByPathway[pathwayId];
                }
            });

            // Check for duplicate gene sets and remove them
            const uniqueGeneSets = new Set();
            const uniquePathways = [];

            Object.values(geneSetByPathway).forEach((pathway) => {
                const geneSetKey = Array.from(pathway.genes).sort().join(",");
                if (!uniqueGeneSets.has(geneSetKey)) {
                    uniqueGeneSets.add(geneSetKey);
                    uniquePathways.push({
                        ...pathway,
                        genes: Array.from(pathway.genes),
                    });
                }
            });

            return uniquePathways;
        } catch (e) {
            throw new Meteor.Error("", e.message);
        }
    },
    MitoCarta: async (code) => {
        let mitoCartaFile = "";
        if (code === "hsa") {
            mitoCartaFile = path.join(Meteor.settings.private.mitocartaDir, "Human.MitoCarta3.0.csv");
        } else if (code === "mmu") {
            mitoCartaFile = path.join(Meteor.settings.private.mitocartaDir, "Mouse.MitoCarta3.0.csv");
        }

        // MitoCarta CSVs are reference data seeded into .data/mitocarta (not shipped in the
        // image). On a fresh persistent volume they may be absent; give a clear, typed error
        // instead of an opaque ENOENT from readFileSync. Checked BEFORE the try below so the
        // code isn't rewrapped to "". See the README, "Reference databases".
        if (!mitoCartaFile || !fs.existsSync(mitoCartaFile)) {
            throw new Meteor.Error(
                "mitocarta-data-missing",
                `MitoCarta reference data not found for organism '${code}'${mitoCartaFile ? ` at ${mitoCartaFile}` : ''}. Ask an administrator to seed .data/mitocarta.`
            );
        }

        try {
            const csvData = fs.readFileSync(mitoCartaFile, 'utf-8');
            const records = csvData.trim().split('\n').slice(1);

            const geneSetByPathway = {};

            for (const record of records) {
                let pathwayName, genesString;
                let taxId
                if (code === "hsa") {
                    [, pathwayName, , genesString] = record.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/);
                    taxId = "9606";
                }
                else if (code === "mmu") {
                    [pathwayName, , genesString] = record.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/);
                    taxId = "10090";
                }
                const cleanedPathwayName = pathwayName.replace(/^"(.*)"$/, '$1');
                const geneSet = genesString.slice(1, -1).split(/,\s*/).map((gene) => gene.trim());

                if (!geneSetByPathway[cleanedPathwayName]) {
                    geneSetByPathway[cleanedPathwayName] = {
                        id: cleanedPathwayName,
                        name: cleanedPathwayName.trim(),
                        genes: [],
                    };
                }

                geneSet.forEach((geneId) => {
                    if (geneId) {
                        geneSetByPathway[cleanedPathwayName].genes.push(geneId);
                    }
                });

                // Convert gene names to Entrez IDs
                let ids = geneSetByPathway[cleanedPathwayName].genes;
                let idType = "Gene_Name";
                let genesMapped = await getMappedGeneIds({ids, idType, taxId});
                let indices = genesMapped.reduce((map, cur) =>
                    map.set(cur.from, (map.get(cur.from) || []).concat([cur.to])), new Map())
                geneSetByPathway[cleanedPathwayName].genes = Array.from(indices.keys())
            }

            // Remove items from geneSetByPathway if genes set is empty
            Object.keys(geneSetByPathway).forEach((pathwayId) => {
                if (geneSetByPathway[pathwayId].genes.length === 0) {
                    delete geneSetByPathway[pathwayId];
                }
            });

            // Check for duplicate gene sets and remove them
            const uniqueGeneSets = new Set();
            const uniquePathways = [];

            Object.values(geneSetByPathway).forEach((pathway) => {
                const geneSetKey = pathway.genes.sort().join(',');
                if (!uniqueGeneSets.has(geneSetKey)) {
                    uniqueGeneSets.add(geneSetKey);
                    uniquePathways.push(pathway);
                }
            });

            return uniquePathways;
        } catch (e) {
            throw new Meteor.Error("", e.message);
        }
    },
}

async function get_gene_set_from_file(file_path, terms) {
    const lineReaderGene = new LineByLineReader(fs.createReadStream(file_path))
    gene_set_by_tax_id = {}
    console.log('processing here')
    await new Promise(r => {
        lineReaderGene.on('line', (line) => {
            let [taxId, geneId, goId] = line.split('\t')
            if (!gene_set_by_tax_id[goId]) gene_set_by_tax_id[goId] = {
                id: goId,
                name: terms[goId],
                genes: []
            }
            gene_set_by_tax_id[goId].genes.push(geneId)
        })
        lineReaderGene.on('end', (line) => {
            r()
        })
    })
}