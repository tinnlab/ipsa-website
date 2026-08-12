import {Meteor} from 'meteor/meteor';
import {CheerioCrawler, Dataset} from 'crawlee';
import {Random} from 'meteor/random';
import {getMappedGeneIds} from './analysis.js';
import Permission from '../helper/Permission';

const BASE_URL = 'https://maayanlab.cloud/Harmonizome';
const API_BASE_URL = 'https://maayanlab.cloud/Harmonizome/api/1.0';

let hsaOrganismId;

const crawler = new CheerioCrawler({
    async requestHandler({$, body, request, enqueueLinks}) {
        const {label} = request.userData;

        if (label === 'START') {
            // Get the 'hsa' organism ID before starting the crawl
            const hsaOrganism = await DBCollections.Organism.findOneAsync({code: "hsa"});
            if (hsaOrganism) {
                hsaOrganismId = hsaOrganism._id;
            } else {
                throw new Error("Organism 'hsa' not found in the database");
            }

            // Handle the initial download page
            const datasets = [];
            $('table.data-table tbody tr').each((_, row) => {
                const $row = $(row);
                const resource = $row.find('td:nth-child(1) a').text().trim();
                const datasetName = $row.find('td:nth-child(2) a').text().trim();
                const datasetUrl = $row.find('td:nth-child(2) a').attr('href');
                const description = $row.find('td:nth-child(3)').text().trim();
                const category = $row.find('td:nth-child(4)').text().trim();
                const attribute = $row.find('td:nth-child(5)').text().trim();
                const views = $row.find('td:nth-child(6)').text().trim();
                const archived = $row.find('td:nth-child(7)').text().trim();

                datasets.push({
                    resource,
                    datasetName,
                    datasetUrl,
                    description,
                    category,
                    attribute,
                    views,
                    archived
                });
            });

            // Enqueue dataset API requests
            for (const dataset of datasets) {
                const apiUrl = `${API_BASE_URL}/${dataset.datasetUrl}`;
                await crawler.addRequests([{
                    url: apiUrl,
                    userData: {label: 'API', datasetInfo: dataset}
                }]);
            }
        } else if (label === 'API') {
            // Handle API responses
            const {datasetInfo} = request.userData;
            let data = JSON.parse(body.toString());
            const apiData = data;

            let newId = Random.id();
            // Insert the dataset into the Database collection
            const {insertedId: databaseId} = await DBCollections.Database.updateAsync(
                {name: apiData.name, namespace: ''},
                {$setOnInsert: {...apiData, _id: newId}},
                {upsert: true}
            );

            // Process gene sets
            for (const geneSet of apiData.geneSets) {
                const geneSetUrl = `${BASE_URL}${geneSet.href}`;
                console.log(`Enqueuing gene set: ${geneSetUrl}`);
                await crawler.addRequests([{
                    url: geneSetUrl,
                    userData: {label: 'GENE_SET', geneSet, databaseId: newId}
                }]);
            }
        } else if (label === 'GENE_SET') {
            // Handle gene set API responses
            const {geneSet, databaseId} = request.userData;
            let data = JSON.parse(body.toString());
            const geneSetData = data;

            // Extract genes from associations
            const geneSymbols = geneSetData.associations.map(association => association.gene.symbol);

            // Convert gene symbols to Entrez IDs
            const mappedGenes = await getMappedGeneIds({
                ids: geneSymbols,
                idType: "Gene_Name",
                taxId: "9606"
            });

            // Create a map of gene symbols to Entrez IDs
            const geneMap = new Map(mappedGenes.map(gene => [gene.to, gene.from]));

            // Filter out genes that weren't mapped and get their Entrez IDs
            const genes = geneSymbols
                .filter(symbol => geneMap.has(symbol))
                .map(symbol => geneMap.get(symbol));

            // Update GeneSet collection
            await DBCollections.GeneSet.updateAsync(
                {database: databaseId, id: geneSet.name},
                {
                    $set: {
                        ...geneSet,
                        database: databaseId,
                        organism: hsaOrganismId,
                        genes: genes
                    }
                },
                {upsert: true}
            );

            console.log(`Processed gene set: ${geneSet.name}, Mapped genes: ${genes.length}/${geneSymbols.length}`);
        }
    },
    maxRequestsPerCrawl: 1000, // Adjust as needed
    additionalMimeTypes: ['application/octet-stream']
});

Meteor.methods({
    async 'harmoni.getSources'() {
        // Crawls an external site and writes the results into the SHARED Database/GeneSet
        // collections that every user's analysis runs against. Operator-only.
        await Permission.isAdmin(this.userId);
        try {
            await crawler.run([{
                url: `${BASE_URL}/download`,
                userData: {label: 'START'}
            }]);

            // Update GeneSetAggregation after all gene sets are processed
            const databases = await DBCollections.Database.find().fetchAsync();
            for (const database of databases) {
                const geneSetCount = await DBCollections.GeneSet.find({database: database._id}).countAsync();
                await DBCollections.GeneSetAggregation.updateAsync(
                    {database: database._id, organism: hsaOrganismId},
                    {
                        $set: {
                            database: database._id,
                            organism: hsaOrganismId,
                            count: geneSetCount
                        }
                    },
                    {upsert: true}
                );
            }

            console.log('Crawler finished successfully');
        } catch (error) {
            console.error('Error during crawling:', error);
            throw new Meteor.Error('crawling-error', 'An error occurred during the crawling process');
        }
    }
});