import {Meteor} from 'meteor/meteor'
import {Random} from 'meteor/random'
import {check, Match} from 'meteor/check'
import _ from 'lodash'
import getUserDataPath from "/server/helper/getUserDataPath";
import {assertInputFileExists, INPUT_FILE_MISSING_ERROR} from "/server/helper/assertInputFileExists";
import rCommand from "/server/include/rCommand"
import {resolveMethodSeed} from "/server/include/rCommand/utils"
import readFile from "/server/api/helper/readFile";
import rEval from '../../include/rEval';
import {analysisContext, killAll as killAnalysisProcesses, markCancelled, consumeCancelled, clearCancelled} from '../../include/processRegistry';
import {buildConsensusMethodColumns} from './consensusInput';
import {resolveConsensusOptions} from '/imports/methods/consensusConfig';
import {shouldRunConsensusForConfigDoc} from '/imports/methods/consensusTrigger';
import {parseGroupData} from '/imports/utils/groupDataUtils';
import {parsePgseaGeneStats, buildPgseaVolcanoRows} from '/imports/utils/pgseaInput';
import {rMetaMethodError} from '/imports/utils/rMetaMethods';
import path from "path";
import Papa from 'papaparse';
import {promises as fs} from 'fs';
import {removeStudy, extendStudy} from '/server/startup/cron-job';
import {
    assertAnalysisIdIsNew,
    assertOwnsAnalysis,
    assertOwnsMassAnalysis,
    assertOwnsSession,
    assertOwnsSessionAnalysis,
    assertWritableAnalysis,
    assertWritableSession,
    assertWritableSessionAnalysis,
} from '/server/helper/ownership';
import {updateMetaAnalysisStatus} from './visualizationCore';
import Permission from '../helper/Permission';
import {daysToMs, sessionExpiryDays} from '/server/helper/retention';

// Guards for values that get string-interpolated into rEval(...) R scripts /
// file paths in the client-callable *.compute methods. They reject anything
// that could break out of an R string literal or path (quotes, parens, slashes,
// semicolons), so a malicious client cannot inject R/shell code. analysisId is
// validated by FORMAT (any well-formed id passes); the meta-analysis method is
// additionally checked against a fixed allow-list since only six values are valid.
const assertSafeAnalysisId = (analysisId) => {
    check(analysisId, String);
    if (!/^[A-Za-z0-9_-]+$/.test(analysisId)) {
        throw new Meteor.Error('invalid-analysis-id', 'analysisId contains unexpected characters');
    }
};
// Method-name validation lives in the pure, testable /imports/utils/rMetaMethods
// helper (VALID_R_META_METHODS + rMetaMethodError). It rejects both R-injection
// characters and clean-but-unknown methods, so the persisted `method` is always one
// the R `match.arg` lists and the UI understand.
const assertSafeRMethod = (selectedMethod) => {
    check(selectedMethod, String);
    const reason = rMetaMethodError(selectedMethod);
    if (reason) {
        throw new Meteor.Error('invalid-method', reason);
    }
};

const getMappedGeneIds = async ({ids, idType, taxId}) => {
    let batchSize = 100
    const batches = [];
    for (let i = 0; i < ids.length; i += batchSize) {
        const batch = ids.slice(i, i + batchSize);
        batches.push(
            DBCollections.EntrezIDMapping.find(
                {to: {$in: batch}, type: idType, taxId: taxId.toString()},
                {fields: {from: 1, _id: 0, to: 1}}
            ).fetchAsync()
        );
    }
    const results = await Promise.all(batches);
    return results.flat();
};

const updateIdTypes = async ({analysisId, inputType, idTypes}) => {
    await Promise.all([
        await DBCollections.AnalysisConfig.updateAsync({
            analysisId,
            inputType,
            key: 'idTypes'
        }, {
            $set: {value: idTypes}
        }, {upsert: true}),

        await DBCollections.AnalysisConfig.updateAsync({
            analysisId,
            inputType,
            key: 'idType'
        }, {
            $set: {value: idTypes[0]}
        }, {upsert: true})
    ])
}

const getMappedGeneIdsFromGeneName = async ({ids, idType, taxId}) => {
    // Modify function to use NCBI API with parallel requests and timed delays
    const batchSize = 350;
    const maxParallelRequests = 8;
    const delayBetweenParallelGroups = 1500;
    const apiKey = Meteor.settings?.private?.PUBMED_API_KEY || process.env.NCBI_API_KEY || '';

    // First collect all possible mappings for each gene symbol
    const allMappings = new Map(); // Maps gene symbol to array of possible gene IDs
    const exactMatches = new Map(); // Maps query symbol to its exact match gene ID

    // Function to process a single batch
    const processBatch = async (batch, batchIndex) => {
        try {
            console.log(`Processing batch ${batchIndex + 1} with ${batch.length} genes`);

            // Build the gene symbols string (comma-separated)
            const symbolsString = batch.join(',');

            // Use pagination to get all results
            let pageToken = null;
            let hasMoreResults = true;

            while (hasMoreResults) {
                // Call the NCBI API with pagination
                let url = `https://api.ncbi.nlm.nih.gov/datasets/v2/gene/symbol/${encodeURIComponent(symbolsString)}/taxon/${taxId}/dataset_report?page_size=${batchSize}`;

                // Add page token if we have one from a previous request
                if (pageToken) {
                    url += `&page_token=${encodeURIComponent(pageToken)}`;
                }

                const response = await fetch(url, {
                    method: 'GET',
                    headers: {
                        'accept': 'application/json',
                        'api-key': apiKey
                    }
                });

                if (!response.ok) {
                    throw new Error(`API request failed with status ${response.status}`);
                }

                const data = await response.json();

                // Process the response to extract gene_id and symbol mappings
                if (data.reports && Array.isArray(data.reports)) {
                    for (const report of data.reports) {
                        if (report.gene && report.gene.gene_id && report.gene.symbol) {
                            const geneId = report.gene.gene_id;
                            const officialSymbol = report.gene.symbol;
                            const synonyms = report.gene.synonyms || [];

                            // Get the original query symbols this result corresponds to
                            const querySymbols = report.query || [];

                            for (const querySymbol of querySymbols) {
                                if (!allMappings.has(querySymbol)) {
                                    allMappings.set(querySymbol, []);
                                }

                                // Store information about the mapping
                                const mapping = {
                                    geneId,
                                    symbol: officialSymbol,
                                    isExactMatch: querySymbol === officialSymbol,
                                    isSynonym: synonyms.includes(querySymbol),
                                    order: allMappings.get(querySymbol).length
                                };

                                // If this is an exact match, store it in our exactMatches map
                                if (mapping.isExactMatch) {
                                    exactMatches.set(querySymbol, geneId);
                                    console.log(`Found exact match for ${querySymbol}: ${geneId}`);
                                }

                                allMappings.get(querySymbol).push(mapping);
                            }
                        }
                    }
                }

                // Check if there are more pages of results
                if (data.next_page_token) {
                    pageToken = data.next_page_token;
                    console.log(`Fetching next page with token: ${pageToken}`);
                } else {
                    hasMoreResults = false;
                }
            }

            console.log(`Completed batch ${batchIndex + 1}`);
        } catch (error) {
            console.error(`Error fetching data for batch ${batchIndex + 1}:`, error);
            // Continue despite errors
        }
    };

    // Create batches
    const batches = [];
    for (let i = 0; i < ids.length; i += batchSize) {
        batches.push(ids.slice(i, i + batchSize));
    }

    console.log(`Processing ${batches.length} batches with max ${maxParallelRequests} parallel requests and ${delayBetweenParallelGroups}ms delay between parallel groups`);

    // Process batches in parallel groups with timed delays
    for (let i = 0; i < batches.length; i += maxParallelRequests) {
        const startTime = Date.now();

        // Get the current group of batches to process in parallel
        const currentBatchGroup = batches.slice(i, i + maxParallelRequests);

        console.log(`Starting parallel group ${Math.floor(i / maxParallelRequests) + 1} with ${currentBatchGroup.length} batches at ${new Date().toLocaleTimeString()}`);

        // Create promises for parallel processing
        const batchPromises = currentBatchGroup.map((batch, index) =>
            processBatch(batch, i + index)
        );

        // Wait for all parallel requests in this group to complete
        await Promise.all(batchPromises);

        const elapsedTime = Date.now() - startTime;
        console.log(`Completed parallel group ${Math.floor(i / maxParallelRequests) + 1} in ${elapsedTime}ms`);

        // Add delay between parallel groups (except after the last group)
        if (i + maxParallelRequests < batches.length) {
            console.log(`Waiting ${delayBetweenParallelGroups}ms before next parallel group...`);
            await new Promise(resolve => setTimeout(resolve, delayBetweenParallelGroups));
        }
    }

    // Prepare final results
    const finalResults = [];
    const usedGeneIds = new Set();

    // First, use exact matches if available
    for (const [querySymbol, geneId] of exactMatches.entries()) {
        finalResults.push({
            from: geneId,
            to: querySymbol,
            source: 'NCBI'
        });
        usedGeneIds.add(geneId);
    }

    // Now process the remaining symbols without exact matches
    const remainingSymbols = [...allMappings.keys()].filter(symbol => !exactMatches.has(symbol));

    // Sort by number of options (ascending) to process more constrained matches first
    remainingSymbols.sort((a, b) => allMappings.get(a).length - allMappings.get(b).length);

    // Count how many gene symbols each gene ID appears in
    const geneIdCounts = new Map();
    for (const symbol of remainingSymbols) {
        const mappings = allMappings.get(symbol);
        for (const mapping of mappings) {
            if (!geneIdCounts.has(mapping.geneId)) {
                geneIdCounts.set(mapping.geneId, 0);
            }
            geneIdCounts.set(mapping.geneId, geneIdCounts.get(mapping.geneId) + 1);
        }
    }

    // Process remaining symbols
    for (const symbol of remainingSymbols) {
        const mappings = allMappings.get(symbol);
        if (!mappings || mappings.length === 0) continue;

        // Try to find a unique gene ID (not used yet)
        let assigned = false;

        // First try to find an ID that's used only by this symbol (appears only once in our data)
        for (const mapping of mappings) {
            if (geneIdCounts.get(mapping.geneId) === 1 && !usedGeneIds.has(mapping.geneId)) {
                finalResults.push({
                    from: mapping.geneId,
                    to: symbol,
                    source: 'NCBI'
                });
                usedGeneIds.add(mapping.geneId);
                assigned = true;
                break;
            }
        }

        // If no exclusive ID found, try any unused ID, prioritizing by match type and original order
        if (!assigned) {
            // Sort priorities: 1. Synonym match, 2. Original order
            const sortedByPriority = [...mappings].sort((a, b) => {
                if (a.isSynonym && !b.isSynonym) return -1;
                if (!a.isSynonym && b.isSynonym) return 1;
                return a.order - b.order;
            });

            for (const mapping of sortedByPriority) {
                if (!usedGeneIds.has(mapping.geneId)) {
                    finalResults.push({
                        from: mapping.geneId,
                        to: symbol,
                        source: 'NCBI'
                    });
                    usedGeneIds.add(mapping.geneId);
                    assigned = true;
                    break;
                }
            }
        }

        // If still not assigned, use the first mapping (will create a duplicate)
        if (!assigned && mappings.length > 0) {
            finalResults.push({
                from: mappings[0].geneId,
                to: symbol,
                source: 'NCBI'
            });
            usedGeneIds.add(mappings[0].geneId);
        }
    }

    // Log information about genes that weren't mapped
    const unmappedGenes = ids.filter(id => !finalResults.some(result => result.to === id));
    if (unmappedGenes.length > 0) {
        console.log(`${unmappedGenes.length} genes could not be mapped:`);
        console.log(unmappedGenes.slice(0, 10).join(', ') + (unmappedGenes.length > 10 ? '...' : ''));
    }

    console.log(`Retrieved ${finalResults.length} gene mappings out of ${ids.length} requested genes`);
    return finalResults;
};

const getMappedGeneIndices = async ({analysisId, inputType, idType, taxId}) => {
    let input = (await DBCollections.AnalysisConfig.findOneAsync({analysisId, inputType, key: 'input'}))?.value
    let background = (await DBCollections.AnalysisConfig.findOneAsync({
        analysisId,
        inputType,
        key: 'background'
    }))?.value || ""
    // if no input, then return
    if (!input) {
        console.log("no input");
        return {};
    }

    let ids = [];
    if (inputType === 'ora') {
        ids = _.uniq(input.trim().split('\n').map(e => e.trim()).filter(e => e.length))
    } else if (inputType === 'pgsea') {
        // 2-column no-header format: Gene\tStatistic
        const geneList = _.uniq(input.trim().split('\n').map(e => e.split('\t')[0].trim()).filter(e => e.length))
        ids = geneList
    } else if (inputType === 'expression') {
        ids = _.uniq(input.rownames)
    }
    const inputMapped = await getMappedGeneIds({ids, idType, taxId})

    const inputMappedIndices = inputMapped.reduce((map, cur) =>
        map.set(cur.from, (map.get(cur.from) || []).concat([cur.to])), new Map())

    const backgroundMapped = await getMappedGeneIds(
        {ids: _.uniq(background.trim().split('\n').map(e => e.trim()).filter(e => e.length)), idType, taxId})
    const backgroundMappedIndices = backgroundMapped.reduce((map, cur) => map.set(cur.from, (map.get(cur.from) || []).concat([cur.to])), new Map())

    return {inputMappedIndices, backgroundMappedIndices}
}

const updateCustomGeneStats = async ({analysisId, customGeneSet}) => {
    let currentGeneStats = await DBCollections.AnalysisConfig.find({
        analysisId,
        key: 'geneStats'
    }).fetchAsync()

    for (let currentGeneStat of currentGeneStats) {
        console.log("Updating gene stats for analysis:", analysisId, currentGeneStat.inputType)

        // Get idType and taxId for gene mapping
        const idType = (await DBCollections.AnalysisConfig.findOneAsync({
            analysisId, inputType: currentGeneStat.inputType, key: 'idType'
        }))?.value
        const taxId = (await DBCollections.AnalysisConfig.findOneAsync({
            analysisId, inputType: currentGeneStat.inputType, key: 'taxId'
        }))?.value

        if (!idType || !taxId) {
            console.log("idType or taxId not found for updateCustomGeneStats");
            continue;
        }

        let input = (await DBCollections.AnalysisConfig.findOneAsync(
            {analysisId, inputType: currentGeneStat.inputType, key: 'input'}))?.value

        if (!input) {
            console.log("No input found for updateCustomGeneStats");
            continue;
        }

        let ids = []
        if (currentGeneStat.inputType === 'expression') {
            ids = _.uniq(input.rownames || [])
        } else if (currentGeneStat.inputType === 'ora') {
            ids = _.uniq(input.trim().split('\n').map(e => e.trim()).filter(e => e.length))
        } else if (currentGeneStat.inputType === 'pgsea') {
            // 2-column no-header format: Gene\tStatistic
            const inputLines = input.trim().split('\n').map(e => e.split('\t')[0].trim()).filter(e => e.length)
            ids = _.uniq(inputLines)
        }

        let backgroundConfig = await DBCollections.AnalysisConfig.findOneAsync(
            {analysisId, inputType: currentGeneStat.inputType, key: 'background'})
        let background = backgroundConfig?.value || ""
        let backgroundIds = _.uniq(background.trim().split('\n').map(e => e.trim()).filter(e => e.length))

        // Map input genes to Gene IDs
        const inputMapped = await getMappedGeneIds({ids, idType, taxId})
        const inputMappedGeneIds = new Set(inputMapped.map(m => m.from)) // from = Gene ID

        // Map background genes to Gene IDs
        const backgroundMapped = await getMappedGeneIds({ids: backgroundIds, idType, taxId})
        const backgroundMappedGeneIds = new Set(backgroundMapped.map(m => m.from)) // from = Gene ID

        // Map custom gene set genes to Gene IDs using analysis organism (taxId)
        const customGeneSetAllGenes = _.uniq(customGeneSet.geneSets.flatMap(gs => gs.genes))

        // Check for cached mapping for this custom gene set + organism combination
        const cacheKey = `customGeneSetMapping_${customGeneSet.id}_${taxId}`
        let cachedMapping = await DBCollections.AnalysisConfig.findOneAsync({
            analysisId, inputType: currentGeneStat.inputType, key: cacheKey
        })

        let customGeneSetMapped
        if (cachedMapping && cachedMapping.value) {
            console.log(`updateCustomGeneStats: Using cached mapping for ${customGeneSet.name} (${customGeneSetAllGenes.length} genes)`)
            customGeneSetMapped = cachedMapping.value
        } else {
            console.log(`updateCustomGeneStats: Mapping ${customGeneSetAllGenes.length} genes for ${customGeneSet.name}...`)
            customGeneSetMapped = await getMappedGeneIds({
                ids: customGeneSetAllGenes,
                idType: 'Gene_Name',
                taxId
            })

            // Cache the mapping result
            await DBCollections.AnalysisConfig.updateAsync({
                analysisId, inputType: currentGeneStat.inputType, key: cacheKey
            }, {
                $set: { value: customGeneSetMapped }
            }, { upsert: true })

            console.log(`updateCustomGeneStats: Cached ${customGeneSetMapped.length} mappings for ${customGeneSet.name}`)
        }

        const customGeneSetMapping = customGeneSetMapped.reduce((map, m) => {
            map.set(m.to, m.from) // Map symbol → Gene ID
            return map
        }, new Map())

        const geneSets = customGeneSet.geneSets.map(geneSet => {
            // Map custom gene set genes to Gene IDs, then check overlap
            const geneSetMappedIds = geneSet.genes
                .map(g => customGeneSetMapping.get(g))
                .filter(id => id)

            let common = geneSetMappedIds.filter(g => inputMappedGeneIds.has(g)).length
            let backgroundCount = geneSetMappedIds.filter(g => backgroundMappedGeneIds.has(g)).length

            let doc = {
                name: geneSet.name,
                genes: geneSet.genes.length,
                id: geneSet.id,
                common
            }

            if (currentGeneStat.inputType === 'ora') {
                doc.background = backgroundCount
            }

            return doc
        })

        if (geneSets.length) {
            // Ensure currentGeneStat.value exists and is an array
            if (!currentGeneStat.value) {
                currentGeneStat.value = [];
            }

            currentGeneStat.value.push({
                name: customGeneSet.name,
                geneSets,
                id: customGeneSet.id,
                isCustom: true
            })
        }
    }

    // Update all gene stats
    await Promise.all(
        currentGeneStats.map(currentGeneStat =>
            DBCollections.AnalysisConfig.updateAsync({
                analysisId,
                inputType: currentGeneStat.inputType,
                key: 'geneStats'
            }, {
                $set: {value: currentGeneStat.value || []}
            }, {upsert: true})
        )
    )
}

const removeCustomGeneStats = async ({analysisId, customGeneSetId}) => {
    let currentGeneStats = await DBCollections.AnalysisConfig.find({
        analysisId,
        key: 'geneStats'
    }).fetchAsync()

    currentGeneStats.forEach(currentGeneStat => {
        // Remove the custom gene set from the current gene stats
        if (currentGeneStat.value) {
            currentGeneStat.value = currentGeneStat.value.filter(geneSet => geneSet.id !== customGeneSetId)

            // Update the analysis config
            DBCollections.AnalysisConfig.updateAsync({
                analysisId,
                inputType: currentGeneStat.inputType,
                key: 'geneStats'
            }, {
                $set: {value: currentGeneStat.value}
            }, {upsert: true})
        }
    })

    // Remove from selectedRows in all input types
    let selectedRows = await DBCollections.AnalysisConfig.find({
        analysisId,
        key: 'selectedRows'
    }).fetchAsync()

    selectedRows.forEach(selectedRow => {
        if (selectedRow.value) {
            selectedRow.value = selectedRow.value.filter(geneSet => geneSet.id !== customGeneSetId)

            DBCollections.AnalysisConfig.updateAsync({
                analysisId,
                inputType: selectedRow.inputType,
                key: 'selectedRows'
            }, {
                $set: {value: selectedRow.value}
            }, {upsert: true})
        }
    })
}

const updateStatistics = async ({analysisId, inputType}) => {
    console.log("updateStatistics")
    const idType = (await DBCollections.AnalysisConfig.findOneAsync({analysisId, inputType, key: 'idType'}))?.value
    const taxId = (await DBCollections.AnalysisConfig.findOneAsync({analysisId, inputType, key: 'taxId'}))?.value
    const selectedDatasets = (await DBCollections.AnalysisConfig.findOneAsync({
        analysisId,
        inputType,
        key: 'selectedDatasets'
    }))?.value

    /* If idType or taxId is not defined, then return. */
    if (!idType || !taxId) {
        console.log("idType or taxId is not defined");
        return {};
    }

    const {inputMappedIndices, backgroundMappedIndices} = await getMappedGeneIndices(
        {analysisId, inputType, idType, taxId})

    if (!inputMappedIndices || !backgroundMappedIndices) {
        console.log("inputMappedIndices or backgroundMappedIndices is not defined - skipping statistics update");
        return {};
    }

    await DBCollections.AnalysisConfig.updateAsync({
        analysisId, inputType, key: 'genesMappedInput'
    }, {
        $set: {value: Array.from(inputMappedIndices.keys())}
    }, {upsert: true})

    await DBCollections.AnalysisConfig.updateAsync({
        analysisId, inputType, key: 'genesMappedBackground'
    }, {
        $set: {value: Array.from(backgroundMappedIndices.keys())}
    }, {upsert: true})

    if (!selectedDatasets) {
        console.log("selectedDatasets is not defined");
        return;
    }
    // update the current gene stats
    await DBCollections.AnalysisConfig.updateAsync({
        analysisId, inputType, key: 'geneStatsProcessingStatus'
    }, {
        $set: {value: "loading"}
    }, {upsert: true})

    // Extract Gene IDs from Map keys (keys are Gene IDs, values are symbols)
    const inputMappedGeneIds = new Set(Array.from(inputMappedIndices.keys()))
    const backgroundMappedGeneIds = new Set(Array.from(backgroundMappedIndices.keys()))

    const geneSets = await Meteor.callAsync('geneSetsByOrganism', {taxId, selectedDatasets})
    let geneStats = geneSets.map(database => {
        let geneSets = database.geneSets.map(geneSet => {
            let common = geneSet.genes.filter(g => inputMappedGeneIds.has(g)).length
            let background = geneSet.genes.filter(g => backgroundMappedGeneIds.has(g)).length
            let doc = {
                name: geneSet.name,
                genes: geneSet.genes.length,
                id: geneSet.id,
                common
            }
            if (inputType === 'ora') {
                doc.background = background
            }
            return doc
        })
        return {
            name: database.name,
            namespace: database.namespace,
            geneSets,
            id: database._id
        }
    }).filter(database => database.geneSets.length) || []

    // get the current gene stats
    // let currentGeneStats = (await DBCollections.AnalysisConfig.findOneAsync({
    //     analysisId,
    //     inputType,
    //     key: 'geneStats'
    // }))?.value || []
    // get custom gene sets
    // const customGeneSets = currentGeneStats.filter(geneSet => geneSet.isCustom)


    await DBCollections.AnalysisConfig.updateAsync({
        analysisId, inputType, key: 'geneStats'
    }, {
        $set: {value: geneStats}
    }, {upsert: true})

    await DBCollections.AnalysisConfig.updateAsync({
        analysisId, inputType, key: 'geneStatsProcessingStatus'
    }, {
        $set: {value: "done"}
    }, {upsert: true})

    // update for custom gene sets
    const customGeneSetIds = selectedDatasets.filter(s => !geneStats.map(g => g.id).includes(s))
    if (customGeneSetIds.length) {
        // get the gene sets from the sessionConfig collection
        const geneSets = await DBCollections.SessionConfig.find(
            {_id: {$in: customGeneSetIds}}).fetchAsync()
        // update the gene sets
        for (const geneSet of geneSets) {
            await updateCustomGeneStats({analysisId, customGeneSet: geneSet.value})
        }
    }
}

const getExpressionFileContent = async ({fileName, sessionId}) => {
    const file = await getUserDataPath(fileName, sessionId)
    console.log("file: ", file)
    // Surface a missing upload as a typed error (e.g. wiped by an old redeploy or auto-purged)
    // so the UI can prompt re-upload instead of failing opaquely inside R.
    assertInputFileExists(file)
    // parse data using R
    const data = await rCommand.getExpressionData({file});
    return data
}

const processGeneExpressionData = async (filePath, idType, taxId, analysisId, inputType) => {
    // Read the CSV file
    const csvContent = await fs.readFile(filePath, 'utf8');

    // Parse CSV with specific options to match input format
    const parsedData = Papa.parse(csvContent, {
        header: true,
        skipEmptyLines: true,
        dynamicTyping: true,
        quotes: false,
        quoteChar: '"',
        escapeChar: '"',
        delimiter: ','
    });

    // Trim keys for data
    parsedData.data = parsedData.data.map(row => {
        let newRow = {}
        for (let key in row) {
            newRow[key.trim()] = (typeof row[key] === 'string') ? row[key].trim() : row[key]
        }
        return newRow
    });

    // Extract headers and gene names
    const headers = parsedData.meta.fields;
    const geneNameField = headers[0];
    const expressionColumns = headers.slice(1);
    const geneNames = _.uniq(parsedData.data.map(row => row[geneNameField]));

    console.log('Number of unique gene names in input:', geneNames.length);
    console.log('Total rows in input:', parsedData.data.length);

    // Get gene ID mappings
    const mappedInputIds = await getMappedGeneIds({
        ids: geneNames,
        idType,
        taxId
    });

    await DBCollections.AnalysisConfig.updateAsync({
        analysisId, inputType, key: 'mappedGeneIds',
    }, {
        $set: {
            value: mappedInputIds
        }
    }, {upsert: true});
    await DBCollections.AnalysisConfigSnapshot.updateAsync({
        analysisId, inputType, key: 'mappedGeneIds',
    }, {
        $set: {
            value: mappedInputIds
        }
    }, {upsert: true});

    // Log mapping statistics
    const uniqueFromIds = _.uniq(mappedInputIds.map(m => m.from));
    const uniqueToNames = _.uniq(mappedInputIds.map(m => m.to));

    console.log('Number of unique "from" IDs:', uniqueFromIds.length);
    console.log('Number of unique "to" gene names:', uniqueToNames.length);

    // Create a simple mapping dictionary (gene name -> ID)
    const nameToIdMap = {};
    mappedInputIds.forEach(item => {
        nameToIdMap[item.to] = item.from;
    });

    // Replace gene names with gene IDs and remove rows without mappings
    const processedData = parsedData.data
        .map(row => {
            const geneName = row[geneNameField];
            const geneId = nameToIdMap[geneName];

            if (geneId) {
                // Create a new row with the gene ID instead of gene name
                const newRow = {...row};
                newRow[geneNameField] = geneId;
                return newRow;
            }

            // If no gene ID mapping found, return null to mark for removal
            return null;
        })
        .filter(row => row !== null); // Remove rows that couldn't be mapped

    // Get average expression value for duplicated gene ids
    const groupedByGeneId = _.groupBy(processedData, row => row[geneNameField]);
    const duplicateCount = Object.keys(groupedByGeneId).filter(geneId => groupedByGeneId[geneId].length > 1).length;
    
    console.log('Number of unique gene IDs before averaging:', Object.keys(groupedByGeneId).length);
    console.log('Number of gene IDs with duplicates:', duplicateCount);

    // Average expression values for duplicate gene IDs
    const averagedData = Object.keys(groupedByGeneId).map(geneId => {
        const rows = groupedByGeneId[geneId];
        
        if (rows.length === 1) {
            // No duplicates, return the single row as is
            return rows[0];
        }
        
        // Create averaged row for duplicates
        const averagedRow = {[geneNameField]: geneId};
        
        // Calculate average for each expression column
        expressionColumns.forEach(column => {
            const values = rows.map(row => row[column]).filter(val => val !== null && val !== undefined && !isNaN(val));
            if (values.length > 0) {
                averagedRow[column] = values.reduce((sum, val) => sum + parseFloat(val), 0) / values.length;
            } else {
                averagedRow[column] = null;
            }
        });
        
        return averagedRow;
    });

    console.log('\nNumber of rows in output after averaging:', averagedData.length);
    console.log('Number of rows removed (no mapping found):', parsedData.data.length - processedData.length);
    console.log('Number of rows consolidated (duplicates averaged):', processedData.length - averagedData.length);
    console.log('Sample of processed data:', averagedData.slice(0, 5));

    // Convert the processed data back to CSV
    const outputCSV = Papa.unparse(averagedData);

    // Overwrite the original CSV file
    await fs.writeFile(filePath, outputCSV);

    console.log(`Original file ${filePath} has been overwritten with gene IDs`);

    return averagedData;
};

const updateSelectedRows = async ({analysisId, selectedRows, customGeneSetId}) => {
    // Update selectedRows for all input types
    for (let inputType of ['expression', 'pgsea', 'ora']) {
        // Find existing selectedRows configuration
        let configResult = await DBCollections.AnalysisConfig.findOneAsync({
            analysisId,
            inputType,
            key: 'selectedRows'
        });

        // Handle case where selectedRows doesn't exist yet
        let currentSelectedRows = configResult?.value || [];

        // Add the new custom gene set selection
        currentSelectedRows.push({
            id: customGeneSetId,
            rowKeys: selectedRows
        })

        // Update or create the selectedRows configuration
        await DBCollections.AnalysisConfig.updateAsync({
            analysisId,
            inputType,
            key: 'selectedRows'
        }, {
            $set: {value: currentSelectedRows}
        }, {upsert: true})
    }
}

const analysisLog = async ({analysisId, inputType, message, isRunning = true, progress, done, errorCode = null}) => {
    const latestLog = await DBCollections.AnalysisLog.findOneAsync({analysisId, inputType}, {sort: {time: -1}})
    if (latestLog && latestLog.isRunning === false) {
        latestLog.done = 0
        latestLog.progress = 0
    }
    await DBCollections.AnalysisLog.updateAsync({
        analysisId, inputType
    }, {
        $set: {
            isRunning,
            progress: progress ? progress : latestLog?.progress || 0,
            done: done ? done : latestLog?.done || 0,
            status: message,
            // Typed code for client branching (e.g. 'input-file-missing' → re-upload prompt).
            // Defaults to null so a fresh log entry / re-run clears any stale code.
            errorCode,
            time: new Date()
        }
    }, {upsert: true})
}

const generateOraResults = async ({mappedInputIds, mappedBackgroundIds, geneSetList, isCustom = false}) => {
    let fileName = path.join(Meteor.settings.private.tempDir, `${Random.id()}_ora.rds`)
    const geneSets = geneSetList.reduce((acc, geneSet) => {
        acc[geneSet.id] = !isCustom ? geneSet.genes : geneSet.mappedGenes
        return acc
    }, {})

    const DEGenes = _.uniq(mappedInputIds.map(e => e.from))
    const DEGenesJson = JSON.stringify(DEGenes)
    const geneSetsJson = JSON.stringify(geneSets)
    const backgroundGenesJson = JSON.stringify(mappedBackgroundIds.map(e => e.from))

    await rEval(`
            saveRDS(list(
                DEGenes = jsonlite::fromJSON(${JSON.stringify(DEGenesJson)}),
                geneSets = jsonlite::fromJSON(${JSON.stringify(geneSetsJson)}),
                backgroundGenes = jsonlite::fromJSON(${JSON.stringify(backgroundGenesJson)}),
                backgroundLength = ${mappedBackgroundIds.length}
            ), file = "${fileName}")
            TRUE
        `)

    const data = await rCommand.ora(fileName)
    return data
}

const runOraAnalysis = async ({analysisConfigSnapshot, analysisId, inputType}) => {
    const mappedInputIds = await getMappedGeneIds({
        ids: _.uniq(analysisConfigSnapshot.input.trim().split('\n').map(e => e.trim()).filter(e => e.length)),
        idType: analysisConfigSnapshot.idType,
        taxId: analysisConfigSnapshot.taxId
    })

    if (!analysisConfigSnapshot.background) {
        analysisConfigSnapshot.background = ''
    }

    const mappedBackgroundIds = await getMappedGeneIds({
        ids: _.uniq(analysisConfigSnapshot.background.trim().split('\n').map(e => e.trim()).filter(e => e.length)),
        idType: analysisConfigSnapshot.idType,
        taxId: analysisConfigSnapshot.taxId
    })

    const geneSetsAll = await Meteor.callAsync('geneSetsByOrganism', {
        taxId: analysisConfigSnapshot.taxId,
        selectedDatasets: analysisConfigSnapshot.selectedDatasets
    }).then(dat => {
        return dat.filter(database => database.geneSets.length)
    })

    const totalGeneSets = geneSetsAll.length + (analysisConfigSnapshot.geneStats ? analysisConfigSnapshot.geneStats.filter(geneSet => geneSet.isCustom).length : 0)

    await Promise.all(geneSetsAll.map(async database => {
        await analysisLog({analysisId, inputType, message: `${database.name} - Running`})
        // run R script
        const data = await generateOraResults({mappedInputIds, mappedBackgroundIds, geneSetList: database.geneSets})

        await DBCollections.AnalysisResult.updateAsync({
            analysisId, inputType, databaseId: database._id, key: 'ora'
        }, {
            $set: {
                value: data,
                updatedAt: new Date()
            }
        }, {upsert: true})

        const latestLog = await DBCollections.AnalysisLog.findOneAsync({analysisId, inputType}, {sort: {time: -1}})
        await analysisLog({
            analysisId,
            inputType,
            message: `${database.name} - Done`,
            done: latestLog?.done + 1,
            progress: Math.ceil((latestLog?.done + 1) * 100 / totalGeneSets)
        })
    }))

    // if there any custom gene sets
    const customGeneSets = analysisConfigSnapshot.geneStats ? analysisConfigSnapshot.geneStats.filter(geneSet => geneSet.isCustom) : []
    if (customGeneSets.length) {
        // get the gene sets from the sessionConfig collection
        const geneSets = await DBCollections.AnalysisConfigSnapshot.find({
            analysisId, inputType, key: 'customGeneSets'
        }).fetchAsync()

        // get the selected rows - handle undefined selectedRows
        const selectedRows = (analysisConfigSnapshot.selectedRows || []).reduce((acc, curr) => {
            acc[curr.id] = curr.rowKeys;
            return acc;
        }, {})

        // update the gene sets
        await Promise.all(geneSets.map(async geneSet => {
            await analysisLog({analysisId, inputType, message: `${geneSet.value.name} - Running`})
            // take only the selected rows and filter out
            const rowKeys = selectedRows[geneSet.value.id] || []
            const geneSetList = geneSet.value.geneSets.filter(geneSet => rowKeys.includes(geneSet.id))
            if (geneSetList.length) {
                const data = await generateOraResults({
                    mappedInputIds,
                    mappedBackgroundIds,
                    geneSetList,
                    isCustom: true
                })
                await DBCollections.AnalysisResult.updateAsync({
                    analysisId, inputType, databaseId: geneSet.value.id, key: 'ora'
                }, {
                    $set: {
                        value: data,
                        updatedAt: new Date()
                    }
                }, {upsert: true})
            }
            const latestLog = await DBCollections.AnalysisLog.findOneAsync({analysisId, inputType}, {sort: {time: -1}})
            await analysisLog({
                analysisId,
                inputType,
                message: `${geneSet.value.name} - Done`,
                done: latestLog?.done + 1,
                progress: Math.ceil((latestLog?.done + 1) * 100 / totalGeneSets)
            })
        }))
    }

    // ✅ UPDATED: Let analysis.start handle final completion
    await analysisLog({analysisId, inputType, message: `Done`})
}

const createPgseaParams = async ({analysisConfigSnapshot, useGeneNames = false}) => {
    // Parse input: canonical 2 columns, no header — `Gene\tStatistic`.
    // The parser lives in /imports/utils/pgseaInput so the ranking-correctness tests can
    // exercise the exact code this method runs (see tests/pgsea-input.tests.js).
    const {inputGeneList, geneData} = parsePgseaGeneStats(analysisConfigSnapshot.input)

    let paramsList;

    if (useGeneNames) {
        // Use gene names directly without conversion to gene IDs
        // This is useful for custom gene sets that use gene names/symbols
        paramsList = inputGeneList.map(gene => {
            const data = geneData[gene];
            return {
                gene: gene,
                geneStat: data?.rankStat || 0
            }
        }).filter(item => item.geneStat !== undefined && !isNaN(item.geneStat))
    } else {
        // Original behavior: convert gene names to gene IDs
        const mappedInputIds = await getMappedGeneIds({
            ids: inputGeneList,
            idType: analysisConfigSnapshot.idType,
            taxId: analysisConfigSnapshot.taxId
        })
        console.log({mappedInputIds})

        const mappedGenes = mappedInputIds.reduce((acc, curr) => {
            acc[curr.from] = _.uniq((acc[curr.from] || []).concat(curr.to))
            return acc
        }, {})

        paramsList = Object.keys(mappedGenes).map(gene => {
            // For genes that map to multiple symbols, average the ranking stat
            const meanRankStat = _.mean(mappedGenes[gene].map(symbol => geneData[symbol]?.rankStat).filter(v => v !== undefined))

            return {
                gene,
                geneStat: meanRankStat
            }
        }).filter(item => !isNaN(item.geneStat))
    }

    return paramsList;
}

// PGSEA now uses 2-column no-header format (Gene + Statistic only)
// DE gene extraction is not supported with this format
const extractDEGenes = async ({analysisConfigSnapshot}) => {
    console.log("extractDEGenes: PGSEA uses 2-column format, DE extraction not supported");
    return null;
};

// Benjamini-Hochberg FDR correction
const adjustPValues = (pValues) => {
    const n = pValues.length;
    const indexed = pValues.map((p, i) => ({p, i})).sort((a, b) => a.p - b.p);
    const adjusted = new Array(n);

    let prevAdjusted = 1;
    for (let rank = n - 1; rank >= 0; rank--) {
        const adjustedP = Math.min(indexed[rank].p * n / (rank + 1), prevAdjusted);
        adjusted[indexed[rank].i] = adjustedP;
        prevAdjusted = adjustedP;
    }

    return adjusted;
};

// Prepare volcanoPlotData for PGSEA (all genes for meta-analysis)
// PGSEA now uses 2-column no-header format (Gene + Statistic only)
// Volcano plots require both FC and p-value, which are not available in this format
const preparePgseaVolcanoPlotData = async ({analysisConfigSnapshot}) => {
    console.log("preparePgseaVolcanoPlotData: PGSEA uses 2-column format, volcano plots not supported");
    return null;
};

const generatePgseaResults = async ({
                                        paramsList,
                                        database,
                                        methods = [],
                                        analysisId,
                                        inputType,
                                        totalMethods,
                                        isCustom = false
                                    }) => {
    const geneSetList = database.geneSets;
    let geneSets = geneSetList.reduce((acc, geneSet) => {
        // For PGSEA, always use original gene names, even for custom gene sets
        // because custom gene sets already contain gene names/symbols, not gene IDs
        acc[geneSet.id] = geneSet.genes
        return acc
    }, {})

    const geneList = JSON.stringify(paramsList.map(gene => gene.gene))
    const geneStat = JSON.stringify(paramsList.map(gene => gene.geneStat))
    geneSets = JSON.stringify(geneSets)

    // run R script for every method
    await Promise.all(Object.keys(methods).filter(method => methods[method].enabled).map(
        async method => {
            await analysisLog({
                analysisId,
                inputType,
                message: `${database.name} - ${method} - Running`
            })
            let rdsFile = path.join(Meteor.settings.private.tempDir, `${Random.id()}_pgsea.rds`);
            if (method === 'fgsea') {
                await rEval(`
                    saveRDS(list(
                        geneList = rjson::fromJSON(${JSON.stringify(geneList)}),
                        geneStat = rjson::fromJSON(${JSON.stringify(geneStat)}),
                        geneSets = rjson::fromJSON(${JSON.stringify(geneSets)}),
                        perm = ${methods[method].permutation},
                        minSize = ${methods[method].minSize},
                        maxSize = ${methods[method].maxSize},
                        seed = ${resolveMethodSeed(methods[method])}
                    ), file = "${rdsFile}")
                    TRUE
                `)
            } else {
                await rEval(`
                    saveRDS(list(
                        geneList = rjson::fromJSON(${JSON.stringify(geneList)}),
                        geneStat = rjson::fromJSON(${JSON.stringify(geneStat)}),
                        geneSets = rjson::fromJSON(${JSON.stringify(geneSets)})
                    ), file = "${rdsFile}")
                    TRUE
                `)
            }
            const data = await rCommand[method]({rdsFile})
            if (database.isCustom) {
                await DBCollections.AnalysisResult.updateAsync({
                    analysisId, inputType, databaseId: database.id, key: method
                }, {
                    $set: {
                        value: data,
                        updatedAt: new Date()
                    }
                }, {upsert: true})
            } else {
                await DBCollections.AnalysisResult.updateAsync({
                    analysisId, inputType, databaseId: database._id.toString(), key: method
                }, {
                    $set: {
                        value: data,
                        updatedAt: new Date()
                    }
                }, {upsert: true})
            }
            if (data) {
                const latestLog = await DBCollections.AnalysisLog.findOneAsync({
                    analysisId, inputType
                }, {sort: {time: -1}})
                await analysisLog({
                    analysisId,
                    inputType,
                    message: `${database.name} - ${method.toUpperCase()} - Done`,
                    done: latestLog?.done + 1,
                    progress: Math.ceil((latestLog?.done + 1) * 100 / totalMethods)
                })
            }
        }
    ));
}

const runPgseaAnalysis = async ({analysisConfigSnapshot, analysisId, inputType, selectedDatasets}) => {
    // Create params for regular gene sets (with gene ID conversion)
    const paramsList = await createPgseaParams({analysisConfigSnapshot, useGeneNames: false})

    // Create params for custom gene sets (using gene names directly)
    const paramsListForCustom = await createPgseaParams({analysisConfigSnapshot, useGeneNames: true})

    console.log(analysisConfigSnapshot.taxId)
    const geneSetsAll = await Meteor.callAsync('geneSetsByOrganism', {
        taxId: analysisConfigSnapshot.taxId,
        selectedDatasets
    }).then(dat => {
        return dat.filter(database => database.geneSets.length)
    })
    const {consensus, ...methodSettings} = analysisConfigSnapshot.methodSettings;
    console.log({geneSetsAll: geneSetsAll[0]?.geneSets ?? []})
    const totalMethods = Object.keys(methodSettings).length * (geneSetsAll.length + (analysisConfigSnapshot.geneStats ? analysisConfigSnapshot.geneStats.filter(geneSet => geneSet.isCustom).length : 0))

    // Process regular gene sets with gene ID conversion
    await Promise.all(geneSetsAll.map(async database => {
        await analysisLog({analysisId, inputType, message: `${database.name} - Running`})
        // Use regular paramsList for standard gene sets
        await generatePgseaResults({
            paramsList, // Uses gene IDs
            database,
            methods: methodSettings,
            analysisId,
            inputType,
            totalMethods
        })
    }))

    // Process custom gene sets with gene names
    const customGeneSets = analysisConfigSnapshot.geneStats ? analysisConfigSnapshot.geneStats.filter(geneSet => geneSet.isCustom) : []
    if (customGeneSets.length) {
        console.log(`=== Processing ${customGeneSets.length} custom gene sets ===`);

        // get the gene sets from the sessionConfig collection
        const geneSets = await DBCollections.AnalysisConfigSnapshot.find({
            analysisId, inputType, key: 'customGeneSets'
        }).fetchAsync()

        console.log(`Found ${geneSets.length} custom gene sets in snapshot`);

        // get the selected rows - handle undefined selectedRows
        const selectedRows = (analysisConfigSnapshot.selectedRows || []).reduce((acc, curr) => {
            acc[curr.id] = curr.rowKeys;
            return acc;
        }, {})

        console.log(`Selected rows configuration:`, Object.keys(selectedRows).length > 0 ? selectedRows : 'No selectedRows found');

        // update the gene sets
        await Promise.all(geneSets.map(async geneSet => {
            await analysisLog({analysisId, inputType, message: `${geneSet.value.name} - Running`})

            // take only the selected rows and filter out
            let rowKeys = selectedRows[geneSet.value.id] || []

            // QUICK FIX: If no selectedRows, select all gene sets by default
            if (rowKeys.length === 0 && geneSet.value.geneSets) {
                console.log(`No selectedRows found for ${geneSet.value.name}, selecting all ${geneSet.value.geneSets.length} gene sets by default`);
                rowKeys = geneSet.value.geneSets.map(gs => gs.id);
            }

            const geneSetList = geneSet.value.geneSets.filter(geneSet => rowKeys.includes(geneSet.id));

            console.log(`Processing ${geneSetList.length} gene sets for ${geneSet.value.name} (total available: ${geneSet.value.geneSets.length})`);

            const database = {
                ...geneSet.value,
                geneSets: geneSetList
            }

            if (geneSetList.length) {
                // Use paramsListForCustom for custom gene sets (uses gene names)
                await generatePgseaResults({
                    paramsList: paramsListForCustom, // Uses gene names
                    database,
                    methods: methodSettings,
                    analysisId,
                    inputType,
                    totalMethods,
                    isCustom: true
                })
            } else {
                console.error(`ERROR: No gene sets to process for ${geneSet.value.name}! This means the custom gene set is empty or filtering failed.`);
            }
        }));
    }

    // Final completion is handled by analysis.start. Consensus is NOT triggered
    // here or in analysis.start — the caller triggers it after analysis.start
    // resolves: the wizard (Step5_RunAnalysis) client-side, and the mass-analysis
    // queue worker (processQueueItem) server-side, both gated by shouldRunConsensus.
    await analysisLog({analysisId, inputType, message: `PGSEA analysis completed`})
}

const generateExprResults = async ({
                                       expressionFile, group, groupNames, controlSamples, conditionSamples,
                                       methods = [], database, analysisId, inputType, totalMethods,
                                       isCustom = false
                                   }) => {
    const geneSetList = database.geneSets;
    let geneSets = geneSetList.reduce((acc, geneSet) => {
        acc[geneSet.id] = !isCustom ? geneSet.genes : geneSet.mappedGenes
        return acc
    }, {})
    geneSets = JSON.stringify(geneSets)
    // run R script for every method
    await Promise.all(Object.keys(methods).filter(method => methods[method].enabled).map(
        async method => {
            const rdsFile = path.join(Meteor.settings.private.tempDir, `${Random.id()}_${method}_expression.rds`);
            let cmd = `
                    data <- read.csv(header = T, file = '${expressionFile}', row.names = 1)
                    controlSamples <- make.names(rjson::fromJSON(${JSON.stringify(controlSamples)}))
                    diseaseSamples <- make.names(rjson::fromJSON(${JSON.stringify(conditionSamples)}))
                    data <- data[, c(controlSamples, diseaseSamples)]
                    geneSets <- rjson::fromJSON(${JSON.stringify(geneSets)})
                    group <- rjson::fromJSON(${JSON.stringify(group)})
                    names(group) <- make.names(rjson::fromJSON(${JSON.stringify(groupNames)}))
                    `;
            if (method === 'fgsea') {
                cmd = cmd + `
                    perm = ${methods[method].permutation}
                    minSize = ${methods[method].minSize}
                    maxSize = ${methods[method].maxSize}
                    seed = ${resolveMethodSeed(methods[method])}
                    saveRDS(list(expr = data, group = group, geneSets = geneSets, perm = perm, minSize = minSize, maxSize = maxSize, seed = seed), file = '${rdsFile}')
                    TRUE
                `;

            } else if (method === 'gsa') {
                // expr, group, geneSets, perm, seed, gsa.method = "maxmean", minSize = 15, maxSize = 1000, perm = 1000)
                cmd = cmd + `
                    perm = ${methods[method].permutation}
                    minSize = ${methods[method].minSize}
                    maxSize = ${methods[method].maxSize}
                    seed = ${methods[method].randomSeed}
                    gsa.method = "${methods[method].method}"
                    saveRDS(list(expr = data, group = group, geneSets = geneSets, perm = perm, seed = seed, gsa.method = gsa.method, minSize = minSize, maxSize = maxSize), file = '${rdsFile}')
                    TRUE
                `;
            } else if (method === 'gsea') {
                // expr, group, geneSets, perm, seed,gs.size.threshold.min = 15, gs.size.threshold.max = 1000
                cmd = cmd + `
                    perm = ${methods[method].permutation}
                    ${database.name === "Reactome" ? "gs.size.threshold.min = 60" : database.namespace === "biological_process" ? "gs.size.threshold.min = 25" : `gs.size.threshold.min = ${methods[method].minSize}`}
                    gs.size.threshold.max = ${methods[method].maxSize}
                    seed = ${methods[method].randomSeed}
                    saveRDS(list(expr = data, group = group, geneSets = geneSets, perm = perm, seed = seed, gs.size.threshold.min = gs.size.threshold.min, gs.size.threshold.max = gs.size.threshold.max), file = '${rdsFile}')
                `;
            } else if (method === 'ora') {
                // expr, group, geneSets, pThreshold, fcThreshold, maxDEGene
                cmd = cmd + `
                    pThreshold = ${methods[method].pThreshold}
                    fcThreshold = ${methods[method].fcThreshold}
                    minDEGene = ${methods[method].minDEGene}
                    saveRDS(list(expr = data, group = group, geneSets = geneSets, pThreshold = pThreshold, fcThreshold = fcThreshold, minDEGene = minDEGene), file = '${rdsFile}')
                `;

            } else if (method === 'padog') {
                // expr, group, geneSet, perm, seed
                cmd = cmd + `
                    perm = ${methods[method].permutation}
                    seed = ${methods[method].randomSeed}
                    saveRDS(list(expr = data, group = group, geneSets = geneSets, perm = perm, seed = seed), file = '${rdsFile}')
                `;
            } else { // for ks/wilcox
                // expr, group, geneSets
                cmd = cmd + `
                    saveRDS(list(expr = data, group = group, geneSets = geneSets), file = '${rdsFile}')
                `;
            }

            // run R script for creating rds file
            await rEval(cmd)
            const dataUnprocessed = await rCommand[`${method}Expr`]({rdsFile})
            // check value for result
            const data = dataUnprocessed.map(res => ({
                ...res,
                pValue: res.pValue ?? 1,
                pValueFDR: res.pValueFDR ?? 1,
                score: res.score ?? 0,
            }))

            if (database.isCustom) {
                await DBCollections.AnalysisResult.updateAsync({
                    analysisId, inputType, databaseId: database.id, key: method
                }, {
                    $set: {
                        value: data,
                        updatedAt: new Date()
                    }
                }, {upsert: true})
            } else {
                await DBCollections.AnalysisResult.updateAsync({
                    analysisId, inputType, databaseId: database._id, key: method
                }, {
                    $set: {
                        value: data,
                        updatedAt: new Date()
                    }
                }, {upsert: true})
            }
            if (data) {
                const latestLog = await DBCollections.AnalysisLog.findOneAsync({
                    analysisId, inputType
                }, {sort: {time: -1}})
                await analysisLog({
                    analysisId,
                    inputType,
                    message: `${database.name} - ${method.toUpperCase()} - Done`,
                    done: latestLog?.done + 1,
                    progress: Math.ceil((latestLog?.done + 1) * 100 / totalMethods)
                })
            }
        }
    ));
}

const runExpressionAnalysis = async ({analysisConfigSnapshot, analysisId, inputType, selectedDatasets}) => {
    const user = await Meteor.userAsync()
    const isGuest = user?.profile.roles.indexOf("guest") !== -1;

    const session = await DBCollections.Session.findOneAsync(
        {"analyses.id": analysisId},
        {fields: {_id: 1}}
    );
    let sessionId = ""
    if (session) {
        sessionId = session._id;
        console.log("Session ID:", sessionId);
    } else {
        console.log("No session found for the given analysisId");
    }

    const expressionFile = await getUserDataPath(analysisConfigSnapshot.expressionFile, sessionId)
    // Fail fast with a typed error if the uploaded file is gone (redeploy/auto-purge), so the
    // client shows a re-upload prompt instead of an opaque R "cannot open the connection".
    assertInputFileExists(expressionFile)

    const controlSamples = JSON.stringify(analysisConfigSnapshot.selectedControlSamples)
    const conditionSamples = JSON.stringify(analysisConfigSnapshot.selectedConditionSamples)

    // make 0 1 array for control samples and condition sample
    const group = JSON.stringify((analysisConfigSnapshot.selectedControlSamples.map(sample => 0) || []).concat(
        (analysisConfigSnapshot.selectedConditionSamples.map(sample => 1) || [])))
    const groupNames = JSON.stringify((analysisConfigSnapshot.selectedControlSamples || []).concat(
        (analysisConfigSnapshot.selectedConditionSamples || [])))

    const geneSetsAll = await Meteor.callAsync('geneSetsByOrganism', {
        taxId: analysisConfigSnapshot.taxId,
        selectedDatasets
    }).then(dat => {
        return dat.filter(database => database.geneSets.length)
    })

    // Remove consensus from methodSettings
    const {consensus, ...methodSettings} = analysisConfigSnapshot.methodSettings;

    const totalMethods = (Object.keys(methodSettings).length) * geneSetsAll.length
    await Promise.all(geneSetsAll.map(async database => {
        await analysisLog({analysisId, inputType, message: `${database.name} - Running`})
        await generateExprResults({
            expressionFile, group, groupNames, controlSamples, conditionSamples,
            methods: methodSettings, database, analysisId, inputType,
            totalMethods
        })
    }))

    // for custom analysis
    const customGeneSets = analysisConfigSnapshot.geneStats ? analysisConfigSnapshot.geneStats.filter(geneSet => geneSet.isCustom) : []
    if (customGeneSets.length) {
        // get the gene sets from the sessionConfig collection
        const geneSets = await DBCollections.AnalysisConfigSnapshot.find({
            analysisId, inputType, key: 'customGeneSets'
        }).fetchAsync()

        // get the selected rows - handle undefined selectedRows
        const selectedRows = (analysisConfigSnapshot.selectedRows || []).reduce((acc, curr) => {
            acc[curr.id] = curr.rowKeys;
            return acc;
        }, {})

        // update the gene sets
        await Promise.all(geneSets.map(async geneSet => {
            await analysisLog({analysisId, inputType, message: `${geneSet.value.name} - Running`})
            // take only the selected rows and filter out
            const rowKeys = selectedRows[geneSet.value.id] || []
            const geneSetList = geneSet.value.geneSets.filter(geneSet => rowKeys.includes(geneSet.id));

            const database = {
                ...geneSet.value,
                geneSets: geneSetList
            }

            if (geneSetList.length) {
                await generateExprResults({
                    expressionFile, group, groupNames, controlSamples, conditionSamples,
                    methods: methodSettings, database, analysisId, inputType,
                    totalMethods, isCustom: true
                })
            }
        }));
    }

    // Final completion is handled by analysis.start. Consensus is NOT triggered
    // here or in analysis.start — the caller triggers it after analysis.start
    // resolves: the wizard (Step5_RunAnalysis) client-side, and the mass-analysis
    // queue worker (processQueueItem) server-side, both gated by shouldRunConsensus.
    await analysisLog({analysisId, inputType, message: `Done`})
}

Meteor.methods({
    // 'analysis.create'
    async 'session.create'({userId, name, inputType = 'ora'}) {
        // A study is always owned by the authenticated caller — require login FIRST (so the
        // logged-out path gets this clear message rather than a generic Match error), then
        // validate args, then never trust a client-supplied userId for another account (userId is
        // also interpolated into the on-disk upload path).
        if (!this.userId) {
            throw new Meteor.Error('not-authorized', 'You must be logged in to create a study.');
        }
        check(userId, String);
        check(name, String);
        if (userId !== this.userId) {
            throw new Meteor.Error('not-authorized', 'You can only create studies for your own account.');
        }
        // Validate inputType
        const validInputTypes = ['ora', 'pgsea', 'expression'];
        const finalInputType = validInputTypes.includes(inputType) ? inputType : 'ora';

        let analyses = [{id: Random.id(), name: 'Analysis', input: finalInputType}]
        let session = {
            _id: Random.id(),
            userId,
            activeAnalysis: analyses[0].id,
            name,
            analyses,
            createdAt: new Date(),
            // Study lifetime is aligned with the file-retention window (operator-configurable via
            // dataRetentionDays; see retention.js). At expiredAt the daily sweep hard-deletes the
            // study AND its files together.
            expiredAt: new Date(Date.now() + daysToMs(sessionExpiryDays())),
            status: "Active",
            editable: true,
            globalSettings: {
                pValueFDR: 0.05,
                pValue: 0.05,
                foldChange: 1.0,
                enrichmentScore: 1.5
            },
            transferHistory: []
        }

        await DBCollections.Session.insertAsync(session)
        return {sessionId: session._id, activeAnalysis: analyses[0].id}
    },
    async 'session.remove'(sessionId) {
        check(sessionId, String);
        if (!this.userId) {
            throw new Meteor.Error('not-authorized', 'You must be logged in to remove a study.');
        }
        // removeStudy enforces ownership + refuses while an analysis is running, then cascades:
        // upload files + every owned DB row (configs, snapshots, results, logs, reports, ...) +
        // the Session doc — the same cascade the expiry sweep uses, so nothing is orphaned.
        return await removeStudy({sessionId, requesterUserId: this.userId});
    },
    async 'session.getName'(sessionId) {
        // get session name
        const session = await assertOwnsSession({sessionId, requesterUserId: this.userId})
        return session.name
    },
    // analyses[] is authorization input — the ownership guards decide access by testing membership
    // of it — so these four are guarded here rather than with the rest of the mutations. Owning the
    // TARGET session is not sufficient on its own for addAnalysis: an attacker owns the study they
    // push into, so the id itself must also be proven not to belong to anyone else.
    async 'session.addAnalysis'({sessionId, analysis}) {
        await assertWritableSession({sessionId, requesterUserId: this.userId})
        check(analysis, Match.ObjectIncluding({id: String}))
        await assertAnalysisIdIsNew({analysisId: analysis.id})
        return DBCollections.Session.updateAsync({_id: sessionId}, {
            $push: {analyses: analysis},
            $set: {activeAnalysis: analysis.id}
        })
    },
    async 'session.setAnalysis'({sessionId, analysisId}) {
        await assertWritableSession({sessionId, requesterUserId: this.userId})
        return DBCollections.Session.updateAsync({_id: sessionId}, {
            $set: {activeAnalysis: analysisId}
        })
    },
    async 'session.removeAnalysis'({sessionId, analysisId, activeAnalysis}) {
        await assertWritableSession({sessionId, requesterUserId: this.userId})
        // TODO: remove all analyses config
        // remove analysis
        return DBCollections.Session.updateAsync({_id: sessionId}, {
            $pull: {analyses: {id: analysisId}},
            $set: {activeAnalysis: activeAnalysis}
        })
    },
    async 'session.updateAnalysis'({sessionId, analysisId, analysis}) {
        await assertWritableSession({sessionId, requesterUserId: this.userId})
        // Replacing the entry must not rewrite its id into someone else's.
        check(analysis, Match.ObjectIncluding({id: String}))
        if (analysis.id !== analysisId) {
            throw new Meteor.Error('not-authorized', 'An analysis id cannot be reassigned.')
        }
        return DBCollections.Session.updateAsync({_id: sessionId, 'analyses.id': analysisId}, {
            $set: {'analyses.$': analysis}
        })
    },
    async 'session.extendExpiration'(sessionId) {
        check(sessionId, String);
        if (!this.userId) {
            throw new Meteor.Error('not-authorized', 'You must be logged in to extend a study.');
        }
        // extendStudy enforces ownership and computes the new expiry SERVER-SIDE (adds one
        // SESSION_EXPIRY_DAYS window to the current expiredAt) — never trusting a client-supplied
        // timestamp, so a client cannot set an arbitrary expiredAt to defeat retention.
        return await extendStudy({sessionId, requesterUserId: this.userId});
    },
    async 'session.getGlobalSettings'(sessionId) {
        const session = await assertOwnsSession({sessionId, requesterUserId: this.userId});
        // Return existing globalSettings or defaults for legacy sessions
        return session.globalSettings || {
            pValueFDR: 0.05,
            pValue: 0.05,
            foldChange: 1.0,
            enrichmentScore: 1.5
        };
    },
    async 'session.updateGlobalSettings'({sessionId, settings}) {
        // Rewrote another user's significance thresholds — which silently changes what their
        // volcano plots and DE counts show — with only an existence check.
        await assertWritableSession({sessionId, requesterUserId: this.userId});
        check(settings, Object);
        return DBCollections.Session.updateAsync(
            {_id: sessionId},
            {$set: {globalSettings: settings}}
        );
    },
    async 'analysis.log'({analysisId, inputType, message, isRunning = true, progress}) {
        // Connection-gated: consensus.js drives this while running, including from the queue worker.
        if (this.connection) {
            await assertOwnsAnalysis({analysisId, requesterUserId: this.userId})
        }
        await analysisLog({analysisId, inputType, message, isRunning, progress})
    },
    async 'analysis.update'({analysisId, inputType, data}) {
        // This method RETURNS AnalysisConfig rows for idType/idTypes/geneStats/input at the end,
        // which is a superset of what analysisSnapshot.getData was guarded for — calling it with an
        // empty `data` was a pure read of another user's input gene list and gene statistics. It
        // also upserts whatever keys `data` carries.
        //
        // Gated on this.connection, which is null ONLY for a top-level server-initiated call (the
        // background queue worker). Note it is NOT null merely because the call is nested: Meteor 3
        // copies userId and connection from the enclosing invocation into a nested Meteor.callAsync
        // (ddp-server livedata_server.js, applyAsync), so a nested call made while serving a client
        // still carries that client's connection and IS checked. That is the stricter direction, and
        // it is why the mass-analysis path has to register the analysis on the session first.
        if (this.connection) {
            // Writable, not merely owned: DE-threshold tuning on a view-only imported study must
            // not persist. The client keeps those changes local; this is the server-side backstop.
            await assertWritableAnalysis({analysisId, requesterUserId: this.userId})
        }
        console.log('analysis.update', analysisId, inputType)
        this.unblock()
        await Promise.all(
            Object.keys(data).map(key => {
                console.log('analysis.update', analysisId, inputType, key)
                let value = data[key]
                return DBCollections.AnalysisConfig.updateAsync({
                    analysisId,
                    inputType,
                    key
                }, {
                    $set: {value}
                }, {upsert: true})
            })
        );

        // if methodSettings or selectedRows is updated, then no need to update statistics
        if (data.methodSettings || data.selectedRows || data.selectedControlSamples || data.selectedConditionSamples) {
            console.log('analysis.update', analysisId, inputType, 'no need to update statistics')
            return
        }

        if (inputType === 'expression') {
            console.log('[Expression Processing] Starting expression data processing for analysisId:', analysisId);
            console.log('[Expression Processing] Data keys:', Object.keys(data));

            const session = await DBCollections.Session.findOneAsync(
                {"analyses.id": analysisId},
                {fields: {_id: 1}}
            );
            let sessionId = ""
            console.log('[Expression Processing] Session query result:', {session, analysisId})
            if (session) {
                sessionId = session._id;
                console.log("[Expression Processing] Session ID found:", sessionId);
            } else {
                console.log("[Expression Processing] ERROR: No session found for the given analysisId:", analysisId);
            }
            if (data.expressionFile) {
                console.log('[Expression Processing] Processing expressionFile:', data.expressionFile, 'with sessionId:', sessionId);

                let fileContents = await getExpressionFileContent({fileName: data.expressionFile, sessionId})
                const trimmedRowNames = fileContents.rownames.map(e => e.trim())

                await DBCollections.AnalysisConfig.updateAsync({
                    analysisId,
                    inputType,
                    key: 'input'
                }, {
                    $set: {
                        value: {
                            data: fileContents.data,
                            rownames: trimmedRowNames,
                            samples: fileContents.samples
                        }
                    }
                }, {upsert: true})
                await DBCollections.AnalysisConfig.updateAsync({
                    analysisId,
                    inputType,
                    key: 'pcaData'
                }, {
                    $set: {
                        value: fileContents.pcaData
                    }
                }, {upsert: true})
                if (trimmedRowNames) {
                    // Get taxId from data or from database
                    let taxId = data.taxId;
                    if (!taxId) {
                        const taxIdConfig = await DBCollections.AnalysisConfig.findOneAsync({
                            analysisId,
                            inputType,
                            key: 'taxId'
                        });
                        taxId = taxIdConfig?.value;
                    }

                    if (taxId) {
                        const idTypes = await Meteor.callAsync('idMapping.getType', {
                            ids: trimmedRowNames,
                            taxId: taxId
                        })
                        // update the idTypes
                        if (idTypes.length) {
                            console.log("idTypes: ", idTypes)
                            await updateIdTypes({analysisId, inputType, idTypes})
                            // convert the gene type to gene id
                            if (idTypes[0] !== 'GeneID' && idTypes[0] !== 'NCBI_TaxID') {
                                const file = await getUserDataPath(data.expressionFile, sessionId)
                                console.log("file: ", file)
                                await processGeneExpressionData(file, idTypes[0], taxId, analysisId, inputType)
                            }
                        }
                    } else {
                        console.log("No taxId found - skipping idType detection")
                    }
                }
                // delete the file with filePath
                // fs.unlinkSync(expressionFilePath)
                await updateStatistics({analysisId, inputType})
            }
            // Process groupFile INDEPENDENTLY of expressionFile (not `else if`): the
            // "Use Sample Data" path sends both keys in one (debounced/merged) update,
            // and a fast double-upload can too. The two blocks write disjoint config
            // keys, so handling groupFile here guarantees `groupData` is written — which
            // gates the Step 2 sample-selection table + the Preview DE button.
            if (data.groupFile) {
                let groupFilePath = await getUserDataPath(data.groupFile, sessionId)
                let groupRows = await readFile.read(groupFilePath);

                await DBCollections.AnalysisConfig.updateAsync({
                    analysisId,
                    inputType,
                    key: 'groupData'
                }, {
                    $set: {
                        value: parseGroupData(groupRows)
                    }
                }, {upsert: true})
                // fs.unlinkSync(groupFilePath)
            }
            // taxId / idType handling stays mutually exclusive and only applies when
            // neither file key is present (preserves the original `else if` chain now
            // that expressionFile/groupFile are handled independently above).
            if (!data.expressionFile && !data.groupFile) {
                if (data.taxId) {
                    const expressionInput = await DBCollections.AnalysisConfig.findOneAsync({
                        analysisId,
                        inputType,
                        key: 'input'
                    })
                    if (expressionInput) {
                        const idTypes = await Meteor.callAsync('idMapping.getType', {
                            ids: expressionInput.value.rownames,
                            taxId: data.taxId
                        })
                        if (idTypes.length) {
                            await updateIdTypes({analysisId, inputType, idTypes})
                        }
                    }
                    await updateStatistics({analysisId, inputType})
                } else if (data.idType || data.selectedDatasets) {
                    await updateStatistics({analysisId, inputType})
                }
            }
        } else {
            // get idTypes
            if (data.input) {
                let idTypes = []
                if (inputType === 'ora') {
                    idTypes = await Meteor.callAsync('idMapping.getType', {
                        ids: _.uniq(data.input.trim().split('\n').map(e => e.trim()).filter(e => e.length))
                    })
                } else if (inputType === 'pgsea') {
                    // 2-column no-header format: Gene\tStatistic
                    const geneList = _.uniq(data.input.trim().split('\n').map(e => e.split('\t')[0].trim()).filter(e => e.length))
                    idTypes = await Meteor.callAsync('idMapping.getType', {
                        ids: geneList
                    })
                }
                if (idTypes.length) {
                    await updateIdTypes({analysisId, inputType, idTypes})
                }

                // Extract DE genes from 3-column PGSEA data
                if (inputType === 'pgsea' && data.input) {
                    const analysisConfigSnapshot = {
                        input: data.input,
                        deGeneThresholds: data.deGeneThresholds,
                        taxId: data.taxId,
                        idType: idTypes?.[0] || 'symbol'
                    };
                    const deGeneData = await extractDEGenes({analysisConfigSnapshot});
                    if (deGeneData) {
                        console.log(`DE extraction: Found ${deGeneData.deCount} DE genes for analysis ${analysisId}`);
                        await DBCollections.AnalysisConfig.updateAsync({
                            analysisId, inputType, key: 'deGenes'
                        }, {
                            $set: {value: deGeneData}
                        }, {upsert: true});
                    }

                    // Prepare volcanoPlotData for gene-level meta-analysis
                    const volcanoPlotData = await preparePgseaVolcanoPlotData({analysisConfigSnapshot});
                    if (volcanoPlotData) {
                        console.log(`Volcano data: Prepared ${volcanoPlotData.length} genes for meta-analysis`);
                        // Save to AnalysisConfig
                        await DBCollections.AnalysisConfig.updateAsync({
                            analysisId, inputType, key: 'volcanoPlotData'
                        }, {
                            $set: {value: volcanoPlotData}
                        }, {upsert: true});

                        // Save to AnalysisConfigSnapshot
                        await DBCollections.AnalysisConfigSnapshot.updateAsync({
                            analysisId, inputType, key: 'volcanoPlotData'
                        }, {
                            $set: {value: volcanoPlotData}
                        }, {upsert: true});
                    }
                }
            } else if (data.taxId) {
                const genes = await DBCollections.AnalysisConfig.findOneAsync({
                    analysisId,
                    inputType,
                    key: 'input'
                })
                if (genes) {
                    let idTypes = []
                    if (inputType === 'ora') {
                        idTypes = await Meteor.callAsync('idMapping.getType', {
                            ids: _.uniq(genes.value.trim().split('\n').map(e => e.trim()).filter(e => e.length)),
                            taxId: data.taxId
                        })
                    } else if (inputType === 'pgsea') {
                        // 2-column no-header format: Gene\tStatistic
                        const geneList = _.uniq(genes.value.trim().split('\n').map(e => e.split('\t')[0].trim()).filter(e => e.length))
                        idTypes = await Meteor.callAsync('idMapping.getType', {
                            ids: geneList,
                            taxId: data.taxId
                        })
                    }

                    if (idTypes.length) {
                        await updateIdTypes({analysisId, inputType, idTypes})
                    }

                    // Extract DE genes from 3-column PGSEA data
                    if (inputType === 'pgsea' && genes) {
                        const analysisConfigSnapshot = {
                            input: genes.value,
                            deGeneThresholds: data.deGeneThresholds,
                            taxId: data.taxId,
                            idType: idTypes?.[0] || 'symbol'
                        };
                        const deGeneData = await extractDEGenes({analysisConfigSnapshot});
                        if (deGeneData) {
                            console.log(`DE extraction: Found ${deGeneData.deCount} DE genes for analysis ${analysisId}`);
                            await DBCollections.AnalysisConfig.updateAsync({
                                analysisId, inputType, key: 'deGenes'
                            }, {
                                $set: {value: deGeneData}
                            }, {upsert: true});
                        }

                        // Prepare volcanoPlotData for gene-level meta-analysis
                        const volcanoPlotData = await preparePgseaVolcanoPlotData({analysisConfigSnapshot});
                        if (volcanoPlotData) {
                            console.log(`Volcano data: Prepared ${volcanoPlotData.length} genes for meta-analysis`);
                            // Save to AnalysisConfig
                            await DBCollections.AnalysisConfig.updateAsync({
                                analysisId, inputType, key: 'volcanoPlotData'
                            }, {
                                $set: {value: volcanoPlotData}
                            }, {upsert: true});

                            // Save to AnalysisConfigSnapshot
                            await DBCollections.AnalysisConfigSnapshot.updateAsync({
                                analysisId, inputType, key: 'volcanoPlotData'
                            }, {
                                $set: {value: volcanoPlotData}
                            }, {upsert: true});
                        }
                    }
                }
            }
            await updateStatistics({analysisId, inputType})
        }
        console.log('analysis.updated', analysisId, inputType)

        return await DBCollections.AnalysisConfig.find({
            analysisId,
            inputType,
            key: {$in: ["idType", "idTypes", "geneStats", "input"]}
        }).fetchAsync()
    },
    async 'analysis.getData'({analysisId, inputType, keys}) {
        await assertOwnsAnalysis({analysisId, requesterUserId: this.userId})
        let data = await DBCollections.AnalysisConfig.find({
            analysisId,
            inputType,
            key: {$in: keys}
        }).fetchAsync()

        return data.reduce((map, cur) => {
            map[cur.key] = cur.value
            return map
        }, {})
    },
    async 'analysis.removeConfig'({analysisId, inputType, key}) {
        // Destructive and untyped: {$ne: null} on any argument was a cross-user config wipe.
        await assertWritableAnalysis({analysisId, requesterUserId: this.userId})
        check(inputType, String)
        check(key, String)
        await DBCollections.AnalysisConfig.removeAsync({analysisId, inputType, key})
    },
    async 'analysisSnapshot.getData'({analysisId, inputType, keys}) {
        // This returns a SUPERSET of what the locked-down /api/deGenes, /api/fcPValueData and
        // /api/customGeneSetsFull expose — volcanoPlotData, DEGenes, geneStats, input, background.
        // Without this guard it was a complete parallel read surface for the same data.
        await assertOwnsAnalysis({analysisId, requesterUserId: this.userId})
        return DBCollections.AnalysisConfigSnapshot.find({
            analysisId,
            inputType,
            key: {$in: keys}
        }).fetchAsync().then(data => {
            return data.reduce((map, cur) => {
                map[cur.key] = cur.value
                return map
            }, {})
        })
    },
    async 'session.add.custom.geneSets'({sessionId, customGeneSet, name, taxId}) {
        await assertWritableSession({sessionId, requesterUserId: this.userId})
        const customGeneSetId = Random.id()

        // Check existing name and ensure uniqueness
        const existingGeneSet = await DBCollections.SessionConfig.find({
            sessionId,
            key: 'customGeneSets',
            "value.name": name
        }).fetchAsync()

        if (existingGeneSet && existingGeneSet.length > 0) {
            name = `${name} (${existingGeneSet.length})`
        }

        // Convert to gene IDs
        const allGenes = Array.from(new Set(customGeneSet.map(geneSet => geneSet.genes).flat()))
        const idTypes = await Meteor.callAsync('idMapping.getType', {
            ids: allGenes,
            taxId // Pass taxId for better ID type detection
        })

        console.log("ID type detected for custom gene set:", idTypes[0])

        const mappedCustomGeneSet = []
        for (const geneSet of customGeneSet) {
            // Map gene names/symbols to gene IDs
            const mappedGeneIds = await getMappedGeneIds({
                ids: geneSet.genes,
                idType: idTypes[0],
                taxId
            })

            mappedCustomGeneSet.push({
                ...geneSet,
                mappedGenes: mappedGeneIds.map(gene => gene.from)
            })
        }

        // Create the custom gene set value object
        let value = {
            name: name,
            geneSets: mappedCustomGeneSet,
            isEnabled: true,
            isCustom: true,
            id: customGeneSetId,
            insertedDate: new Date(),
            taxId: taxId // Store the organism info
        }

        // Insert into SessionConfig collection
        await DBCollections.SessionConfig.insertAsync({
            sessionId,
            key: 'customGeneSets',
            value,
            _id: customGeneSetId,
        })

        // Get all analyses in this session
        let session = await DBCollections.Session.findOneAsync({_id: sessionId})
        let analyses = session.analyses

        // Update gene statistics for all analyses in the session
        await Promise.all(
            analyses.map(analysis => {
                return updateCustomGeneStats({
                    analysisId: analysis.id,
                    customGeneSet: value
                })
            })
        )

        // Initialize selectedRows for all analyses - select all gene sets by default
        const allGeneSetIds = customGeneSet.map(geneSet => geneSet.id);
        await Promise.all(
            analyses.map(analysis => {
                return updateSelectedRows({
                    analysisId: analysis.id,
                    selectedRows: allGeneSetIds, // Select all gene sets by default
                    customGeneSetId
                })
            })
        )

        return customGeneSetId; // Return the ID for reference
    },
    async 'session.remove.custom.geneSets'({sessionId, customGeneSetId}) {
        // Ownership first: the removeAsync below keys on the gene-set id alone, so an unguarded
        // call deleted a custom gene set out of any user's study.
        const session = await assertWritableSession({sessionId, requesterUserId: this.userId})
        check(customGeneSetId, String)
        // Scope the delete to this session so a foreign gene-set id cannot be removed.
        await DBCollections.SessionConfig.removeAsync({
            _id: customGeneSetId,
            sessionId
        })

        let analyses = session.analyses

        // Remove custom gene set from all analyses
        await Promise.all(
            analyses.map(analysis => {
                return removeCustomGeneStats({
                    analysisId: analysis.id,
                    customGeneSetId
                })
            })
        )
    },
    async 'session.update.custom.geneSets'({sessionId, customGeneSetId, name,}) {
        const session = await assertWritableSession({sessionId, requesterUserId: this.userId})
        check(customGeneSetId, String)
        check(name, String)
        // Scoped to this session so a foreign gene-set id cannot be renamed.
        await DBCollections.SessionConfig.updateAsync({
            _id: customGeneSetId,
            sessionId
        }, {
            $set: {
                "value.name": name
            }
        })
        let analyses = session.analyses

        const geneStats = await DBCollections.AnalysisConfig.find({
            analysisId: {$in: analyses.map(analysis => analysis.id)},
            key: 'geneStats'
        }).fetchAsync()

        for (let geneStat of geneStats) {
            geneStat.value.forEach(geneSet => {
                if (geneSet.id === customGeneSetId) {
                    geneSet.name = name
                }
            })

            await DBCollections.AnalysisConfig.updateAsync({
                _id: geneStat._id
            }, {
                $set: {
                    value: geneStat.value
                }
            })
        }
    },
    async 'analysis.start'({analysisId, inputType, sessionId, deferCompletion = false}) {
        this.unblock();
        // Destructive: the two deleteMany calls below wipe this analysis's logs and results before
        // re-running it. Unguarded, any caller could erase another user's completed results.
        // Connection-gated because the mass-analysis queue worker drives it (processQueueItem);
        // that path runs nested inside massAnalysis.create, so it inherits the owner's connection
        // and IS checked — by which point the analysis is already on the session.
        if (this.connection) {
            await assertWritableAnalysis({analysisId, requesterUserId: this.userId})
        }
        console.log('analysis.start', {analysisId, inputType})
        // Drop any stale cancel flag from a prior aborted cancel so a genuine
        // failure in this run is never misreported as a cancellation.
        clearCancelled(analysisId)
        await DBCollections.AnalysisLog.rawCollection().deleteMany({
            analysisId, inputType
        })

        // remove previous analysis results
        await DBCollections.AnalysisResult.rawCollection().deleteMany({
            analysisId, inputType
        })

        await analysisLog({analysisId, inputType, message: 'Analysis starting'})

        try {
            // Run inside the analysis context so every R subprocess spawned by
            // this analysis is tracked and can be killed by analysis.cancel.
            await analysisContext.run({analysisId}, async () => {
            // create a snapshot of the analysis config
            const analysisConfig = await DBCollections.AnalysisConfig.find({analysisId, inputType}).fetchAsync()
            const analysisConfigSnapshot = analysisConfig.reduce((acc, cur) => {
                acc[cur.key] = cur.value
                return acc
            }, {})

            // if no input, idType, or taxId, then throw error
            if (!analysisConfigSnapshot.geneStats || !analysisConfigSnapshot.geneStats.length) {
                throw new Meteor.Error('analysis.start.error', 'No gene statistics found')
            }
            await analysisLog({analysisId, inputType, message: 'Analysis config snapshot creating'})

            // remove all old analysis config data from snapshot collection
            await DBCollections.AnalysisConfigSnapshot.rawCollection().deleteMany({analysisId, inputType})
            // insert snapshot into snapshot collection
            await DBCollections.AnalysisConfigSnapshot.rawCollection().insertMany(analysisConfig.map(cur => {
                return {
                    ...cur,
                    _id: Random.id()
                }
            }))

            // create snapshot of the session config (custom gene sets)
            const sessionConfig = await DBCollections.SessionConfig.find({sessionId}).fetchAsync()
            if (sessionConfig.length) {
                await DBCollections.AnalysisConfigSnapshot.rawCollection().insertMany(sessionConfig.map(config => {
                    return {
                        _id: Random.id(),
                        analysisId,
                        inputType,
                        key: config.key,
                        value: config.value,
                        sessionId
                    }
                }))
            }

            // run the analysis
            const selectedDatasets = (await DBCollections.AnalysisConfig.findOneAsync({
                analysisId,
                inputType,
                key: 'selectedDatasets'
            }))?.value

            if (inputType === 'ora') {
                await analysisLog({analysisId, inputType, message: `Analysis running for ${inputType}`})
                await runOraAnalysis({analysisConfigSnapshot, analysisId, inputType})
            } else if (inputType === 'pgsea') {
                await analysisLog({analysisId, inputType, message: `Analysis running for ${inputType}`})
                await runPgseaAnalysis({analysisConfigSnapshot, analysisId, inputType, selectedDatasets})
            } else if (inputType === 'expression') {
                await runExpressionAnalysis({analysisConfigSnapshot, analysisId, inputType, selectedDatasets})
            }

            // Mark the per-method analysis done. If a consensus step follows
            // (caller passes deferCompletion), keep the run in a "running" state
            // at 95% so the UI doesn't briefly flash "completed" and then drop
            // back to 95% — consensus.processAnalysis writes the final Done/100
            // in its finally block. When nothing follows, finalize here.
            if (deferCompletion) {
                await analysisLog({
                    analysisId,
                    inputType,
                    message: 'Finalizing',
                    isRunning: true,
                    progress: 95
                })
            } else {
                await analysisLog({
                    analysisId,
                    inputType,
                    message: 'Done',
                    isRunning: false,
                    progress: 100
                })
            }

            console.log(`Analysis ${analysisId} (${inputType}) completed successfully`)
            });

        } catch (error) {
            // If the user cancelled, the R process was killed and rEval rejected —
            // report it as cancelled, not failed, and don't rethrow.
            if (consumeCancelled(analysisId)) {
                console.log(`analysis.start cancelled for ${analysisId} (${inputType})`)
                await analysisLog({
                    analysisId,
                    inputType,
                    message: 'Analysis cancelled',
                    isRunning: false,
                    progress: 0
                })
                return
            }
            console.log('analysis.start.error', error)
            // Preserve the typed "missing uploaded file" error so the client can show a
            // re-upload prompt; the generic wrapper below would otherwise mask the code.
            const isMissingFile = error?.error === INPUT_FILE_MISSING_ERROR
            await analysisLog({
                analysisId,
                inputType,
                message: isMissingFile
                    ? `Analysis failed: ${error.reason || error.message}`
                    : `Analysis failed: ${error.message}`,
                isRunning: false,
                progress: 0,
                // Persist the typed code so the client shows the re-upload banner even on a
                // fresh mount (e.g. user returns to the session after a redeploy).
                errorCode: isMissingFile ? INPUT_FILE_MISSING_ERROR : null
            })
            if (isMissingFile) {
                throw error
            }
            // Pass a string reason (not the Error object) so it survives the DDP round-trip
            // and the client shows a real message instead of "[object Object]".
            throw new Meteor.Error('analysis.start.error', error?.message || 'Analysis failed')
        }
    },
    async 'analysis.cancel'({analysisId, inputType}) {
        this.unblock()
        // Killed another user's running R subprocesses when unguarded.
        await assertWritableAnalysis({analysisId, requesterUserId: this.userId})
        console.log('analysis.cancel', {analysisId, inputType})
        // Remember this was a deliberate cancel before killing, so the pipeline's
        // catch handler doesn't log it as a failure.
        markCancelled(analysisId)
        const killed = killAnalysisProcesses(analysisId)
        await analysisLog({
            analysisId,
            inputType,
            message: 'Analysis cancelled',
            isRunning: false,
            progress: 0
        })
        return {cancelled: true, killed}
    },
    async 'pgsea.rankGenes'({analysisId, inputType, rankingMethod}) {
        // Returns the analysis's full Gene/Fold-Change/P-value input table, and rewrites its
        // stored input/rankingBy rows.
        await assertWritableAnalysis({analysisId, requesterUserId: this.userId})
        // rankingMethod: 'original' | 'foldChange' | 'pValue'
        console.log('pgsea.rankGenes', {analysisId, inputType, rankingMethod})
        this.unblock()

        const inputConfig = await DBCollections.AnalysisConfig.findOneAsync({
            analysisId, inputType, key: 'input'
        })

        if (!inputConfig || !inputConfig.value) {
            throw new Meteor.Error('pgsea.rankGenes.error', 'No input data found')
        }

        const inputRows = inputConfig.value.trim().split('\n').map(row => row.replace('\r', ''))
        const inputHeader = inputRows[0]
        const inputHeaderCols = inputHeader.split('\t')

        // Only rank if we have 3 columns (Gene + FC + P-value)
        if (inputHeaderCols.length !== 3) {
            throw new Meteor.Error('pgsea.rankGenes.error', 'Ranking requires 3-column format: Gene, Fold-Change, P-value')
        }

        if (rankingMethod === 'original') {
            // No sorting needed, return original
            return {
                sortedInput: inputConfig.value,
                message: 'Using original gene order'
            }
        }

        // Detect column order
        const secondColIsP = inputHeaderCols[1].toLowerCase().includes("p")

        // Parse data rows
        const dataRows = inputRows.slice(1).map(row => {
            const parts = row.split('\t')
            const gene = parts[0].trim()
            const pValue = parseFloat(secondColIsP ? parts[1].trim() : parts[2].trim())
            const foldChange = parseFloat(secondColIsP ? parts[2].trim() : parts[1].trim())

            return { gene, pValue, foldChange, originalRow: row }
        }).filter(row => !isNaN(row.pValue) && !isNaN(row.foldChange))

        // Sort based on ranking method
        if (rankingMethod === 'foldChange') {
            dataRows.sort((a, b) => Math.abs(b.foldChange) - Math.abs(a.foldChange)) // Descending by absolute FC
        } else if (rankingMethod === 'pValue') {
            dataRows.sort((a, b) => a.pValue - b.pValue) // Ascending by p-value
        }

        // Reconstruct sorted input
        const sortedRows = [inputHeader, ...dataRows.map(row => row.originalRow)]
        const sortedInput = sortedRows.join('\n')

        // Update the input in database
        await DBCollections.AnalysisConfig.updateAsync({
            analysisId, inputType, key: 'input'
        }, {
            $set: { value: sortedInput }
        })

        // Also update rankingBy field
        await DBCollections.AnalysisConfig.updateAsync({
            analysisId, inputType, key: 'rankingBy'
        }, {
            $set: { value: rankingMethod }
        }, { upsert: true })

        return {
            sortedInput,
            message: rankingMethod === 'foldChange'
                ? 'Genes ranked by Fold Change (highest to lowest)'
                : 'Genes ranked by P-value (most significant first)',
            topGenes: dataRows.slice(0, 10).map(r => ({
                gene: r.gene,
                foldChange: r.foldChange.toFixed(3),
                pValue: r.pValue.toExponential(3)
            }))
        }
    },
    async 'ora.run.volcano.plot'({analysisId, inputType}) {
        // Reads the analysis's config, runs R, and overwrites its config/snapshot rows.
        await assertWritableAnalysis({analysisId, requesterUserId: this.userId})
        console.log('ora.run.volcano.plot', {analysisId, inputType})
        this.unblock()

        const analysisConfig = await DBCollections.AnalysisConfig.find({
            analysisId, inputType,
            key: {$in: ['expressionFile', 'selectedControlSamples', 'selectedConditionSamples', 'maxAdjustedPValue', 'minLogFoldChange']}
        }).fetchAsync()

        const analysisConfigSnapshot = analysisConfig.reduce((acc, cur) => {
            acc[cur.key] = cur.value
            return acc
        }, {})

        // Fail fast with a clear message if prerequisites are missing, instead of
        // letting an undefined expressionFile reach getUserDataPath/path.join (which
        // throws a cryptic TypeError) or an undefined samples array hit .map().
        if (!analysisConfigSnapshot.expressionFile) {
            throw new Meteor.Error('ora.run.volcano.plot.error', 'No expression file found. Please upload (or load sample) expression data first.')
        }
        if (!analysisConfigSnapshot.selectedControlSamples?.length || !analysisConfigSnapshot.selectedConditionSamples?.length) {
            throw new Meteor.Error('ora.run.volcano.plot.error', 'Select control and condition samples before running differential expression.')
        }

        if (!analysisConfigSnapshot.maxAdjustedPValue) {
            analysisConfigSnapshot.maxAdjustedPValue = 0.05
            await DBCollections.AnalysisConfig.updateAsync({
                analysisId, inputType, key: 'maxAdjustedPValue'
            }, {
                $set: {
                    value: analysisConfigSnapshot.maxAdjustedPValue
                }
            }, {upsert: true});
        }
        if (!analysisConfigSnapshot.minLogFoldChange) {
            analysisConfigSnapshot.minLogFoldChange = 0.5
            await DBCollections.AnalysisConfig.updateAsync({
                analysisId, inputType, key: 'minLogFoldChange'
            }, {
                $set: {
                    value: analysisConfigSnapshot.minLogFoldChange
                }
            }, {upsert: true});
        }

        // const expressionFile = path.join.apply(null, [Meteor.settings.private.userDataDir,
        //     isGuest ? 'guest' : 'user', user._id, analysisConfigSnapshot.expressionFile].flat())
        const session = await DBCollections.Session.findOneAsync(
            {"analyses.id": analysisId},
            {fields: {_id: 1}}
        );
        let sessionId = ""
        if (session) {
            sessionId = session._id;
        } else {
            console.log("No session found for the given analysisId");
        }
        const expressionFile = await getUserDataPath(analysisConfigSnapshot.expressionFile, sessionId)
        // Fail fast with a typed error if the uploaded file is gone (redeploy/auto-purge), so the
        // client shows a re-upload prompt instead of an opaque R "cannot open the connection".
        assertInputFileExists(expressionFile)

        const controlSamples = JSON.stringify(analysisConfigSnapshot.selectedControlSamples)
        const conditionSamples = JSON.stringify(analysisConfigSnapshot.selectedConditionSamples)

        // make 0 1 array for control samples and condition sample
        const group = JSON.stringify((analysisConfigSnapshot.selectedControlSamples.map(e => 0) || []).concat(
            (analysisConfigSnapshot.selectedConditionSamples.map(e => 1) || [])))
        const groupNames = JSON.stringify((analysisConfigSnapshot.selectedControlSamples || []).concat(
            (analysisConfigSnapshot.selectedConditionSamples || [])))

        let cmd = `
                expr <- read.csv(header = T, file = '${expressionFile}', row.names = 1)
                controlSamples <- make.names(rjson::fromJSON(${JSON.stringify(controlSamples)}))
                diseaseSamples <- make.names(rjson::fromJSON(${JSON.stringify(conditionSamples)}))
                expr <- expr[, c(controlSamples, diseaseSamples)]
                group <- rjson::fromJSON(${JSON.stringify(group)})
                names(group) <- make.names(rjson::fromJSON(${JSON.stringify(groupNames)}))
                
                group <- factor(c('c', 'd')[group + 1])
                design <- model.matrix(~0 + group)
                colnames(design) <- levels(group)
                
                top <- limma::topTable(limma::eBayes(limma::contrasts.fit(
                limma::lmFit(expr, design),
                limma::makeContrasts(contrasts = "d-c", levels = design)
                )), coef = 1, number = nrow(expr), confint = TRUE)
                
                avgExp <- rowMeans(expr)
                names(avgExp) <- rownames(expr)
                
                res <- data.frame(top[, c('logFC', 'P.Value')])
                colnames(res)<- c("FC", "pValue")
                res$id <- rownames(top)
                res$avgExp <- avgExp[res$id]
                res$pValueFDR <- p.adjust(res$pValue, method = 'fdr')
                res$fitted <- loess(res$FC~res$avgExp, span=0.5, degree=1)$fitted
                res$logFCSE <- (top$CI.R - top$logFC) / qnorm(0.975)
                
                res
                `;

        const data = await rEval(cmd, {analysisId})
        console.log("length DE genes", data.length)

        // get list of ids from data
        let filteredData = data.filter(e => e.pValueFDR <= Number(analysisConfigSnapshot.maxAdjustedPValue) &&
            Math.abs(e.FC) >= Number(analysisConfigSnapshot.minLogFoldChange)
        )
        console.log("after filtering", filteredData.length)
        let geneIds = filteredData.map(e => e.id)
        let geneInfoData = await Meteor.callAsync("visualization.getGeneInfo", geneIds)
        let finalGeneInfoData = geneInfoData.map(gene => {
            return {
                FC: filteredData.filter(e => e.id === gene._id).map(e => e.FC)[0],
                pValueFDR: filteredData.filter(e => e.id === gene._id).map(e => e.pValueFDR)[0],
                pValue: filteredData.filter(e => e.id === gene._id).map(e => e.pValue)[0],
                ...gene
            }
        })
        // save the DE gene list to DB
        await DBCollections.AnalysisConfig.updateAsync({
            analysisId, inputType, key: 'DEGenes'
        }, {
            $set: {
                value: finalGeneInfoData
            }
        }, {upsert: true});

        await DBCollections.AnalysisConfigSnapshot.updateAsync({
            analysisId, inputType, key: 'DEGenes'
        }, {
            $set: {
                value: finalGeneInfoData
            }
        }, {upsert: true});

        await DBCollections.AnalysisConfig.updateAsync({
            analysisId, inputType, key: 'volcanoPlotData'
        }, {
            $set: {
                value: data
            }
        }, {upsert: true});

        await DBCollections.AnalysisConfigSnapshot.updateAsync({
            analysisId, inputType, key: 'volcanoPlotData'
        }, {
            $set: {
                value: data
            }
        }, {upsert: true});
        console.log('ora.run.volcano.plot.done', {analysisId, inputType})
        return true;
    },
    async 'meta.analysis.DE.compute'({selectedExpressionData, selectedMethod, analysisId, name}) {
        try {
            // Connection-gated: meta.analysis.compute drives this nested, and that outer method
            // has already proven ownership of the same analysis.
            if (this.connection) {
                await assertWritableAnalysis({analysisId, requesterUserId: this.userId});
            }
            // analysisId + selectedMethod are interpolated into the R script / file
            // path below; validate at this client-callable boundary (see helpers).
            assertSafeAnalysisId(analysisId);
            assertSafeRMethod(selectedMethod);
            let fileName = path.join(Meteor.settings.private.tempDir, `${analysisId}_meta_analysis.rds`);
            let data = [];
            selectedExpressionData.forEach((analysis, i) => {
                // For PGSEA analyses, use default sample size of 20 (10 per group) if not available
                const isPgsea = analysis.inputType === 'pgsea';
                const defaultSampleSize = 20;
                const totalSampleSize = isPgsea
                    ? defaultSampleSize
                    : (analysis.selectedConditionSamplesCount + analysis.selectedControlSamplesCount);

                data.push({
                    id: JSON.stringify(analysis.fcPValueData.map(e => parseInt(e.id))),
                    // pValue: JSON.stringify(analysis.fcPValueData.map(e => e.pValue)),
                    pValue: JSON.stringify(analysis.fcPValueData.map(e => e.pValueFDR)),
                    logFC: JSON.stringify(analysis.fcPValueData.map(e => e.FC)),
                    logFCSE: JSON.stringify(analysis.fcPValueData.map(e => e.logFCSE)),
                    sampleSize: JSON.stringify(analysis.fcPValueData.map(e => totalSampleSize))
                });
            });

            await rEval(`
            saveRDS(list(
              DEResults = list(
                ${data.map((d, i) => `
                  data.frame(
                    ID = jsonlite::fromJSON(${JSON.stringify(d.id)}),
                    p.value = jsonlite::fromJSON(${JSON.stringify(d.pValue)}),
                    logFC = jsonlite::fromJSON(${JSON.stringify(d.logFC)}),
                    logFCSE = jsonlite::fromJSON(${JSON.stringify(d.logFCSE)}),
                    sampleSize = jsonlite::fromJSON(${JSON.stringify(d.sampleSize)})
                  )
                `).join(',\n')}
              ),
              method = "${selectedMethod}"), file = "${fileName}")
            TRUE
          `);

            const result = await rCommand.DEMetaAnalysis(fileName);

            // Enrich results with gene information
            // Convert gene IDs to strings because GeneInfo._id is stored as string
            const geneIds = result.map(gene => String(gene.ID));
            const geneInfos = await DBCollections.GeneInfo.find({
                _id: {$in: geneIds}
            }).fetchAsync();

            // Create a map for quick lookup (using string keys)
            const geneInfoMap = {};
            geneInfos.forEach(info => {
                geneInfoMap[String(info._id)] = {
                    symbol: info.symbol,
                    description: info.description
                };
            });

            // Transform result to match expected format
            const enrichedResult = result.map(gene => {
                const geneIdStr = String(gene.ID);
                const geneInfo = geneInfoMap[geneIdStr];

                return {
                    _id: gene.ID,  // MongoDB-style ID field (expected by frontend)
                    ID: gene.ID,
                    id: gene.ID,  // Add lowercase id for compatibility
                    pValue: gene.pValue,
                    pValueFDR: gene.pFDR,  // Rename pFDR to pValueFDR
                    logFC: gene.logFC,
                    FC: Math.pow(2, gene.logFC),  // Convert logFC to FC
                    logFCSE: gene.logFCSE,
                    symbol: geneInfo?.symbol || geneIdStr,
                    description: geneInfo?.description || ''
                };
            });

            let inputType = 'metaDE';
            // Unlike the pathway-level result, we do NOT persist `method` here: every
            // DE method produces a real per-gene standard error (logFCSE) and there is
            // no gene-level funnel plot, so no consumer needs to branch on the method.
            await DBCollections.AnalysisConfig.updateAsync({
                analysisId, inputType, key: 'volcanoPlotData', name
            }, {
                $set: {
                    value: enrichedResult
                }
            }, {upsert: true});

            await DBCollections.AnalysisConfigSnapshot.updateAsync({
                analysisId, inputType, key: 'volcanoPlotData', name
            }, {
                $set: {
                    value: enrichedResult
                }
            }, {upsert: true});

            return {status: 'completed', analysisId};
        } catch (error) {
            console.error('Error in meta.analysis.DE.compute:', error);
            throw error; // Propagate the error to be handled by the caller
        }
    },

    async 'meta.analysis.pathway.compute'({selectedPathwayResData, selectedMethod, analysisId, name}) {
        console.log('meta.analysis.pathway.compute', {selectedPathwayResData, selectedMethod, analysisId, name});

        try {
            // Connection-gated, as meta.analysis.DE.compute above.
            if (this.connection) {
                await assertWritableAnalysis({analysisId, requesterUserId: this.userId});
            }
            // analysisId + selectedMethod are interpolated into the R script / file
            // path below; validate at this client-callable boundary (see helpers).
            assertSafeAnalysisId(analysisId);
            assertSafeRMethod(selectedMethod);
            let fileName = path.join(Meteor.settings.private.tempDir, `${analysisId}_meta_analysis.rds`);

            for (const key of Object.keys(selectedPathwayResData)) {
                let data = [];
                const i = Object.keys(selectedPathwayResData).indexOf(key);
                Object.keys(selectedPathwayResData[key]).forEach((key2, j) => {
                    data.push({
                        id: JSON.stringify(selectedPathwayResData[key][key2].map(e => e.pathway)),
                        // pValue: JSON.stringify(selectedPathwayResData[key][key2].map(e => e.pValue)),
                        pValue: JSON.stringify(selectedPathwayResData[key][key2].map(e => e.pValueFDR)),
                        score: JSON.stringify(selectedPathwayResData[key][key2].map(e => e.score)),
                        // sample size should be constant 20 for all pathways
                        sampleSize: JSON.stringify(selectedPathwayResData[key][key2].map(e => 20))
                    });
                });

                await rEval(`
                saveRDS(list(
                  PAResults = list(
                    ${data.map((d, i) => `
                      data.frame(
                        ID = jsonlite::fromJSON(${JSON.stringify(d.id)}),
                        p.value = jsonlite::fromJSON(${JSON.stringify(d.pValue)}),
                        normalizedScore = jsonlite::fromJSON(${JSON.stringify(d.score)}),
                        sampleSize = jsonlite::fromJSON(${JSON.stringify(d.sampleSize)})
                      )
                    `).join(',\n')}
                  ),
                  method = "${selectedMethod}"), file = "${fileName}")
                TRUE
              `);

                const result = await rCommand.PathwayMetaAnalysis(fileName);

                let inputType = 'meta';
                // save to analysisResult
                await DBCollections.AnalysisResult.updateAsync({
                    analysisId, inputType, databaseId: key, key: 'meta'
                }, {
                    $set: {
                        value: result,
                        // Persist the method so the client can tell whether a funnel
                        // plot is possible (only REML produces per-study standard errors).
                        method: selectedMethod,
                        updatedAt: new Date()
                    }
                }, {upsert: true});
            }

            return {status: 'completed', analysisId};
        } catch (error) {
            console.error('Error in meta.analysis.pathway.compute:', error);
            throw error; // Propagate the error to be handled by the caller
        }
    },

    async 'meta.analysis.compute'({
        sessionId,
        analysisId,
        name,
        geneLevel,
        pathwayLevel
    }) {
        // Unified meta-analysis compute method
        // Computes both gene-level and pathway-level analyses
        await assertWritableSessionAnalysis({sessionId, analysisId, requesterUserId: this.userId});
        const results = {
            geneLevel: null,
            pathwayLevel: null
        };

        try {
            // Compute gene-level meta-analysis if provided
            if (geneLevel && geneLevel.selectedExpressionData) {
                try {
                    await updateMetaAnalysisStatus({
                        sessionId,
                        analysisId,
                        level: 'gene',
                        status: 'processing'
                    });

                    const geneResult = await Meteor.callAsync('meta.analysis.DE.compute', {
                        selectedExpressionData: geneLevel.selectedExpressionData,
                        selectedMethod: geneLevel.method,
                        analysisId,
                        name
                    });

                    await updateMetaAnalysisStatus({
                        sessionId,
                        analysisId,
                        level: 'gene',
                        status: geneResult.status === 'completed' ? 'completed' : 'failed'
                    });

                    results.geneLevel = geneResult;
                } catch (error) {
                    console.error('Error in gene-level meta-analysis:', error);
                    await updateMetaAnalysisStatus({
                        sessionId,
                        analysisId,
                        level: 'gene',
                        status: 'failed'
                    });
                    results.geneLevel = {status: 'failed', error: error.message};
                }
            }

            // Compute pathway-level meta-analysis if provided
            if (pathwayLevel && pathwayLevel.selectedPathwayResData) {
                try {
                    await updateMetaAnalysisStatus({
                        sessionId,
                        analysisId,
                        level: 'pathway',
                        status: 'processing'
                    });

                    const pathwayResult = await Meteor.callAsync('meta.analysis.pathway.compute', {
                        selectedPathwayResData: pathwayLevel.selectedPathwayResData,
                        selectedMethod: pathwayLevel.method,
                        analysisId,
                        name
                    });

                    await updateMetaAnalysisStatus({
                        sessionId,
                        analysisId,
                        level: 'pathway',
                        status: pathwayResult.status === 'completed' ? 'completed' : 'failed'
                    });

                    results.pathwayLevel = pathwayResult;
                } catch (error) {
                    console.error('Error in pathway-level meta-analysis:', error);
                    await updateMetaAnalysisStatus({
                        sessionId,
                        analysisId,
                        level: 'pathway',
                        status: 'failed'
                    });
                    results.pathwayLevel = {status: 'failed', error: error.message};
                }
            }

            return {
                status: 'completed',
                analysisId,
                results
            };
        } catch (error) {
            console.error('Error in meta.analysis.compute:', error);
            throw error;
        }
    },

    async 'consensus.analysis.pathway.compute'({
                                                   selectedPathwayResData,
                                                   selectedMethod,
                                                   selectedRankBy,
                                                   enrichmentMethods,
                                                   analysisId,
                                                   name,
                                                   inputType
                                               }) {
        try {
            // This method is client-callable and string-interpolates values into
            // an R script, so validate at the trust boundary.
            assertSafeAnalysisId(analysisId);
            // selectedMethod/selectedRankBy are interpolated raw into R; route them
            // through the shared whitelist so any non-whitelisted (e.g. injection)
            // value falls back to the safe default and can never reach R.
            //
            // The comment here used to decline an ownership gate, citing "the app's anonymous
            // session flow". There is no anonymous flow — session.create has required a login for
            // some time — so the gate is applied, connection-gated because consensus.js drives this
            // from the queue worker as well as from the client.
            if (this.connection) {
                await assertWritableAnalysis({analysisId, requesterUserId: this.userId});
            }
            const {method: safeMethod, rankBy: safeRankBy} =
                resolveConsensusOptions({consensus_method: selectedMethod, rankBy: selectedRankBy});
            // Track R processes under this analysis so a Cancel during the
            // consensus step (≈95%) kills them too.
            return await analysisContext.run({analysisId}, async () => {
            let fileName = path.join(Meteor.settings.private.tempDir, `${analysisId}_consensus_analysis.rds`);
            for (const dbId of Object.keys(selectedPathwayResData)) {
                let data = [];

                // For each database, get all the methods (gsea, ora, fgsea)
                const methods = selectedPathwayResData[dbId];

                // Process each method's pathway data
                Object.keys(methods).forEach(methodName => {
                    const pathways = methods[methodName];
                    // Feed the raw p-value AND the genuine per-method FDR as
                    // separate columns (RCPA's RRA ranks by pFDR). Previously the
                    // raw p-value was discarded and pValueFDR (which itself held
                    // the raw p-value) was sent as `p.value`. See consensusInput.js.
                    const cols = buildConsensusMethodColumns(pathways);
                    data.push({
                        id: JSON.stringify(cols.id),
                        pValue: JSON.stringify(cols.pValue),
                        pFDR: JSON.stringify(cols.pFDR),
                        name: JSON.stringify(cols.name),
                        score: JSON.stringify(cols.score),
                        sampleSize: JSON.stringify(pathways.map(() => 20))
                    });
                });
                await rEval(`
                saveRDS(list(
                  PAResults = list(
                    ${data.map((d, i) => `
                      data.frame(
                        ID = jsonlite::fromJSON(${JSON.stringify(d.id)}),
                        p.value = jsonlite::fromJSON(${JSON.stringify(d.pValue)}),
                        pFDR = jsonlite::fromJSON(${JSON.stringify(d.pFDR)}),
                        normalizedScore = jsonlite::fromJSON(${JSON.stringify(d.score)}),
                        sampleSize = jsonlite::fromJSON(${JSON.stringify(d.sampleSize)}),
                        name = jsonlite::fromJSON(${JSON.stringify(d.name)})
                      )
                    `).join(',\n')}
                  ),
                  method = "${safeMethod}",
                  rank.by = "${safeRankBy}"), file = "${fileName}")
                TRUE
              `);

                const result = await rCommand.ConsensusAnalysis(fileName);

                await DBCollections.AnalysisResult.updateAsync({
                    analysisId,
                    inputType,
                    databaseId: dbId,
                    key: 'consensus',
                    enrichmentMethods
                }, {
                    $set: {
                        value: result,
                        updatedAt: new Date()
                    }
                }, {
                    upsert: true
                });
            }

            return {status: 'completed', analysisId};
            });
        } catch (error) {
            console.error('Error in consensus.analysis.pathway.compute:', error);
            throw error;
        }
    },

    async 'analysis.results.aggregate'({analysisId, inputType, geneSets}) {
        // Returns per-pathway pValue/pValueFDR/score and gene lists for an analysis, so it is a
        // read path to study data and needs the same guard as the rest.
        //
        // Gated on this.connection rather than split into a core function, to avoid relocating the
        // 130-line body. connection is null only for a top-level server-initiated call — the queue
        // worker's consensus run. A nested Meteor.callAsync INHERITS the enclosing invocation's
        // userId and connection in Meteor 3 (livedata_server.js, applyAsync), so a client-initiated
        // consensus run still reaches this check; by then the caller's ownership of the same
        // analysis has already been proven by consensus.processAnalysis.
        if (this.connection) {
            await assertOwnsAnalysis({analysisId, requesterUserId: this.userId})
        }
        // First, let's create a lookup map for quick reference
        const geneSetLookup = new Map(geneSets.map(({id, name, namespace, geneSets}) => [
            id,
            {
                name: name === 'GO' ? `GO-${namespace}` : name,
                geneSetsMap: new Map(geneSets.map(gs => [gs.id, gs]))
            }
        ]));

        const databaseIds = Array.from(geneSetLookup.keys());

        // Fetch actual gene sets from database to get gene arrays
        const allPathwayIds = [];
        geneSets.forEach(({geneSets: gsList}) => {
            gsList.forEach(gs => allPathwayIds.push(gs.id));
        });

        const dbGeneSets = await DBCollections.GeneSet.find({
            id: { $in: allPathwayIds }
        }).fetchAsync();

        // Create a map of pathway ID -> genes array
        const pathwayGenesMap = new Map();
        dbGeneSets.forEach(gs => {
            pathwayGenesMap.set(gs.id, gs.genes || []);
        });

        // Use MongoDB aggregation pipeline
        const pipeline = [
            // Match initial criteria
            {
                $match: {
                    analysisId,
                    inputType,
                    databaseId: {$in: databaseIds}
                }
            },
            // Unwind the value array to process each geneSet independently
            {$unwind: '$value'},
            // Group by database and pathway to combine results
            {
                $group: {
                    _id: {
                        databaseId: '$databaseId',
                        key: '$key',
                        pathway: '$value.pathway'
                    },
                    pValues: {$push: '$value.pValue'},
                    pValuesFDR: {$push: '$value.pValueFDR'}, // Use pre-calculated FDR values
                    scores: {$push: '$value.score'}
                }
            },
            // Group again to organize by database
            {
                $group: {
                    _id: '$_id.databaseId',
                    pathways: {
                        $push: {
                            key: '$_id.key',
                            pathway: '$_id.pathway',
                            pValues: '$pValues',
                            pValuesFDR: '$pValuesFDR', // Include FDR values in the output
                            scores: '$scores'
                        }
                    }
                }
            }
        ];

        const results = await DBCollections.AnalysisResult.rawCollection().aggregate(pipeline).toArray();

        if (results.length === 0) return {};

        // Process results (without FDR calculation)
        const tData = {};

        for (const result of results) {
            const geneSetInfo = geneSetLookup.get(result._id);
            if (!geneSetInfo) continue;

            const {name: databaseKey, geneSetsMap} = geneSetInfo;
            const methodsData = {};

            // Group pathways by key (method)
            const pathwaysByKey = result.pathways.reduce((acc, pathway) => {
                if (!acc[pathway.key]) acc[pathway.key] = [];
                acc[pathway.key].push(pathway);
                return acc;
            }, {});

            // Process each method
            for (const [key, pathways] of Object.entries(pathwaysByKey)) {
                // Sort by p-value but use pre-calculated FDR instead of computing it
                const pValueData = pathways.map((pathway, index) => ({
                    pathway: pathway.pathway,
                    pValue: pathway.pValues[0], // Assuming single p-value per pathway
                    pValueFDR: pathway.pValuesFDR[0], // Use pre-calculated FDR
                    score: pathway.scores[0],
                    originalIndex: index
                })).sort((a, b) => a.pValue - b.pValue);

                const results = [];

                for (let i = 0; i < pValueData.length; i++) {
                    const entry = pValueData[i];
                    const geneSetInfo = geneSetsMap.get(entry.pathway);

                    if (geneSetInfo) {
                        results.push({
                            name: geneSetInfo.name,
                            pathway: entry.pathway,
                            pValue: entry.pValue,
                            pValueFDR: entry.pValueFDR, // Use pre-calculated FDR
                            score: entry.score,
                            genes: pathwayGenesMap.get(entry.pathway) || [] // Get genes array from database
                        });
                    }
                }

                if (results.length > 0) {
                    methodsData[key] = results.sort((a, b) => a.pValue - b.pValue);
                }
            }

            if (Object.keys(methodsData).length > 0) {
                tData[databaseKey] = {
                    methods: [methodsData]
                };
            }
        }

        return tData;
    },

    async 'analysis.updateDEGenes'({analysisId, inputType, newDEGenes}) {
        // Overwrites DE genes in both the live config AND the snapshot that is meant to be the
        // immutable original, so an unguarded call was an unrecoverable edit to another user's data.
        await assertWritableAnalysis({analysisId, requesterUserId: this.userId})
        let geneIds = newDEGenes.map(gene => gene.id)
        let geneInfoData = await Meteor.callAsync("visualization.getGeneInfo", geneIds)
        let finalGeneInfoData = geneInfoData.map(gene => {
            return {
                FC: newDEGenes.filter(e => e.id === gene._id).map(e => e.FC)[0],
                ...gene
            }
        })

        console.log('New DE Genes:', finalGeneInfoData.length)

        // save the DE gene list to DB
        await DBCollections.AnalysisConfig.updateAsync({
            analysisId, inputType, key: 'DEGenes'
        }, {
            $set: {
                value: finalGeneInfoData
            }
        }, {upsert: true});

        await DBCollections.AnalysisConfigSnapshot.updateAsync({
            analysisId, inputType, key: 'DEGenes'
        }, {
            $set: {
                value: finalGeneInfoData
            }
        }, {upsert: true});
    },
    // NOTE: 'analysis.updateSnapshotConfig' was removed. AnalysisConfigSnapshot is the IMMUTABLE
    // original DE definition (captured at analysis.start); nothing may write DE thresholds into it
    // after creation, or "Use all DE Genes" could no longer recover the original DE gene set.
    async 'pgsea.volcano.plot'({analysisId, inputType}) {
        await assertWritableAnalysis({analysisId, requesterUserId: this.userId})
        console.log("pgsea.volcano.plot", {analysisId, inputType})
        this.unblock()

        const analysisConfig = await DBCollections.AnalysisConfig.find({
            analysisId, inputType,
            key: {
                // maxAdjustedPValue/minLogFoldChange must be listed or the defaulting block
                // below reads them as undefined on every call and upserts 0.05/0.5 back over
                // whatever thresholds the user had tuned.
                $in: ['input', 'inputRaw', 'idType', 'taxId', 'mappedGeneIds',
                      'maxAdjustedPValue', 'minLogFoldChange']
            }
        }).fetchAsync()

        const analysisConfigSnapshot = analysisConfig.reduce((acc, cur) => {
            acc[cur.key] = cur.value
            return acc
        }, {})

        if (!analysisConfigSnapshot.maxAdjustedPValue) {
            analysisConfigSnapshot.maxAdjustedPValue = 0.05
            await DBCollections.AnalysisConfig.updateAsync({
                analysisId, inputType, key: 'maxAdjustedPValue'
            }, {
                $set: {
                    value: analysisConfigSnapshot.maxAdjustedPValue
                }
            }, {upsert: true});
        }
        if (!analysisConfigSnapshot.minLogFoldChange) {
            analysisConfigSnapshot.minLogFoldChange = 0.5
            await DBCollections.AnalysisConfig.updateAsync({
                analysisId, inputType, key: 'minLogFoldChange'
            }, {
                $set: {
                    value: analysisConfigSnapshot.minLogFoldChange
                }
            }, {upsert: true});
        }

        // DE genes need BOTH a fold-change and a p-value, so read the user's original upload
        // (`inputRaw`) rather than `input` — the latter is the canonical 2-column
        // `Gene\tStatistic` collapsed by the selected ranking, which no longer carries
        // p-values. Falls back to `input` for analyses saved before inputRaw existed.
        // normalizePgseaInput handles header/no-header, 2-or-3 columns and tab-or-comma, so
        // the previous positional/exact-string column sniffing is no longer needed.
        // Reads `inputRaw` (the user's original upload) rather than `input`, which has been
        // collapsed to a single ranking statistic and no longer carries p-values. The parse and
        // its three no-op exits live in /imports/utils/pgseaInput so they can be tested without
        // a database — see tests/pgsea-input.tests.js. Returning early on `skipped` matters:
        // falling through would overwrite existing DEGenes/volcanoPlotData (and the immutable
        // snapshot) with empty arrays.
        const {pcaData, skipped} = buildPgseaVolcanoRows(analysisConfigSnapshot)
        if (skipped) {
            console.log('pgsea.volcano.plot: skipping DE genes —', skipped)
            return true
        }

        // Thresholds for DE gene filtering
        const maxPValue = analysisConfigSnapshot.maxAdjustedPValue
        const minFC = analysisConfigSnapshot.minLogFoldChange

        let geneIdType = analysisConfigSnapshot.idType
        const nameToIdMap = {}
        let mappedGeneIds = analysisConfigSnapshot.mappedGeneIds || []

        // Only perform gene ID mapping if not already cached
        if (geneIdType !== 'GeneID' && geneIdType !== 'NCBI_TaxID' && mappedGeneIds.length === 0) {
            console.log('pgsea.volcano.plot: Performing gene ID mapping for', pcaData.length, 'genes')
            const geneIds = pcaData.map(geneData => geneData.id)
            mappedGeneIds = await getMappedGeneIds({
                ids: geneIds,
                idType: geneIdType,
                taxId: analysisConfigSnapshot.taxId
            })

            await DBCollections.AnalysisConfig.updateAsync({
                analysisId, inputType, key: 'mappedGeneIds',
            }, {
                $set: {
                    value: mappedGeneIds
                }
            }, {upsert: true});
            await DBCollections.AnalysisConfigSnapshot.updateAsync({
                analysisId, inputType, key: 'mappedGeneIds',
            }, {
                $set: {
                    value: mappedGeneIds
                }
            }, {upsert: true});
        } else if (mappedGeneIds.length > 0) {
            console.log('pgsea.volcano.plot: Using cached gene ID mappings')
        }

        mappedGeneIds.forEach(item => {
            nameToIdMap[item.to] = item.from
        })

        // Filter DE genes based on thresholds BEFORE fetching gene info
        const deGenesFiltered = pcaData.filter(geneData =>
            geneData.pValue < maxPValue && Math.abs(geneData.FC) > minFC
        )
        console.log('deGenes', deGenesFiltered.length, 'out of', pcaData.length, 'total genes')

        // Only fetch gene info for DE genes, not all genes (huge performance improvement!)
        const deGeneIds = geneIdType === 'GeneID' || geneIdType === 'NCBI_TaxID'
            ? deGenesFiltered.map(geneData => geneData.id)
            : deGenesFiltered.map(geneData => nameToIdMap[geneData.id] || geneData.id).filter(id => id)

        let geneInfoData = deGeneIds.length > 0
            ? await Meteor.callAsync("visualization.getGeneInfo", deGeneIds)
            : []

        const deGenes = deGenesFiltered.map(geneData => ({
            _id: nameToIdMap[geneData.id] || geneData.id,
            FC: geneData.FC,
            symbol: geneData.id,
            description: geneInfoData.find(gene => gene._id === (nameToIdMap[geneData.id] || geneData.id))?.description || '',
        }))
        await DBCollections.AnalysisConfig.updateAsync({
            analysisId, inputType, key: 'DEGenes'
        }, {
            $set: {
                value: deGenes
            }
        }, {upsert: true});

        await DBCollections.AnalysisConfigSnapshot.updateAsync({
            analysisId, inputType, key: 'DEGenes'
        }, {
            $set: {
                value: deGenes
            }
        }, {upsert: true})

        await DBCollections.AnalysisConfig.updateAsync({
            analysisId, inputType, key: 'volcanoPlotData'
        }, {
            $set: {
                value: pcaData
            }
        }, {upsert: true});

        await DBCollections.AnalysisConfigSnapshot.updateAsync({
            analysisId, inputType, key: 'volcanoPlotData'
        }, {
            $set: {
                value: pcaData
            }
        }, {upsert: true});
        console.log('pgsea.volcano.plot.done', {analysisId, inputType})
        return true;
    },
    async 'analysis.getMappedGeneIds'({analysisId, inputType}) {
        await assertOwnsAnalysis({analysisId, requesterUserId: this.userId})
        const data = await DBCollections.AnalysisConfig.findOneAsync({
            analysisId, inputType, key: 'mappedGeneIds'
        })
        return data?.value || []
    },

    /**
     * Extract structured metadata from text using LLM
     */
    async 'analysis.extractMetadata'({analysisId, inputType, metadataText}) {
        check(analysisId, String);
        check(inputType, String);
        check(metadataText, String);

        // Import LLM config
        const { getDefaultLLM } = await import('../../llm/config.js');

        try {
            const llm = getDefaultLLM();

            const systemPrompt = `You are a data extraction assistant. Extract structured metadata from the provided text.

The metadata may be in various formats:
- Key-value pairs (e.g., "Tissue: Liver" or "Disease = Cancer")
- Plain text descriptions
- JSON or CSV format
- Free-form experimental notes

Extract the following types of information if present:
- Organism/Species
- Tissue/Cell type
- Disease/Condition
- Treatment/Drug
- Time point/Duration
- Experimental conditions
- Any other relevant metadata

IMPORTANT:
- Extract only information explicitly stated in the text
- Do not infer or guess values
- Normalize keys to be clear and consistent (e.g., "tissue_type" not "Tissue")
- Keep values as provided in the text

Return a JSON object with extracted metadata. Use snake_case for keys.
Example:
{
  "organism": "Homo sapiens",
  "tissue_type": "Liver",
  "disease": "Hepatocellular carcinoma",
  "treatment": "Drug A, 10μM",
  "time_point": "24 hours"
}

Return ONLY the JSON object, no markdown code blocks.`;

            const userPrompt = `Extract structured metadata from this text:\n\n${metadataText}`;

            const response = await llm.chat([
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt }
            ]);

            // Parse the LLM response
            let extracted = {};
            try {
                // Remove markdown code blocks if present
                let content = response.content.trim();
                if (content.startsWith('```')) {
                    content = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
                }
                extracted = JSON.parse(content);
            } catch (parseError) {
                console.error('Failed to parse LLM response:', parseError);
                // Fallback to empty object
                extracted = {};
            }

            return {
                extracted,
                confidence: Object.keys(extracted).length > 0 ? 'high' : 'low',
                model: response.model || 'unknown'
            };
        } catch (error) {
            console.error('LLM extraction failed:', error);

            // Fallback to basic pattern matching
            const extracted = {};
            const lines = metadataText.split(/\r?\n/);

            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed || trimmed.startsWith('#')) continue;

                // Try "Key: Value" format
                let match = trimmed.match(/^([A-Za-z\s\/\(\)]+):\s*(.+)$/);
                if (match) {
                    const key = match[1].trim().toLowerCase().replace(/\s+/g, '_');
                    const value = match[2].trim();
                    if (key && value) {
                        extracted[key] = value;
                    }
                    continue;
                }

                // Try "Key = Value" format
                match = trimmed.match(/^([A-Za-z\s\/\(\)]+)\s*=\s*(.+)$/);
                if (match) {
                    const key = match[1].trim().toLowerCase().replace(/\s+/g, '_');
                    const value = match[2].trim();
                    if (key && value) {
                        extracted[key] = value;
                    }
                }
            }

            // Try JSON format
            try {
                const jsonData = JSON.parse(metadataText);
                if (typeof jsonData === 'object' && !Array.isArray(jsonData)) {
                    Object.assign(extracted, jsonData);
                }
            } catch (e) {
                // Not JSON, use pattern matching results
            }

            return {
                extracted,
                confidence: Object.keys(extracted).length > 0 ? 'medium' : 'low',
                fallback: true
            };
        }
    },

    /**
     * Rule-based metadata assessment (fallback when LLM fails)
     */
    performRuleBasedAssessment(metadata, analysisType) {
        const hasOrganism = metadata.organism && metadata.organism.trim() !== '';
        const hasTissue = metadata.tissue && metadata.tissue.trim() !== '';
        const hasDisease = metadata.disease && metadata.disease.trim() !== '';
        const hasExperimentalContext = metadata.experimental_context && metadata.experimental_context.trim() !== '';
        const hasComparison = metadata.comparison && metadata.comparison.trim() !== '';

        // Check if we have enough context
        const hasBiologicalContext = hasDisease || hasExperimentalContext;
        const hasComparingContext = hasComparison || (hasExperimentalContext && (metadata.experimental_context.includes('vs') || metadata.experimental_context.includes('comparing')));

        // Determine if sufficient
        const is_sufficient = hasOrganism && hasBiologicalContext;

        // Determine completeness level
        let completeness_level = 'minimal';
        if (is_sufficient) {
            if (hasTissue && hasComparison) {
                completeness_level = 'excellent';
            } else if (hasTissue || hasComparison) {
                completeness_level = 'good';
            }
        }

        // Build available context list
        const available_context = [];
        if (hasOrganism) available_context.push('organism');
        if (hasTissue) available_context.push('tissue');
        if (hasDisease) available_context.push('disease');
        if (hasExperimentalContext) available_context.push('experimental_context');
        if (hasComparison) available_context.push('comparison');

        // Build missing lists
        const missing_critical = [];
        const missing_recommended = [];

        if (!hasOrganism) missing_critical.push('organism');
        if (!hasBiologicalContext) missing_critical.push('disease or experimental_context');
        if (!hasTissue) missing_recommended.push('tissue');
        if (!hasComparison && !hasComparingContext) missing_recommended.push('comparison');

        // Determine study type
        let study_type_detected = 'other';
        if (hasDisease) {
            study_type_detected = 'disease';
        } else if (hasExperimentalContext) {
            const contextLower = metadata.experimental_context.toLowerCase();
            if (contextLower.includes('treatment') || contextLower.includes('drug')) {
                study_type_detected = 'treatment';
            } else if (contextLower.includes('exposure') || contextLower.includes('radiation')) {
                study_type_detected = 'exposure';
            }
        }

        // Build user message
        let user_message = '';
        if (is_sufficient) {
            user_message = `Metadata is sufficient for AI interpretation (${completeness_level} level).`;
        } else {
            user_message = `Additional information needed: ${missing_critical.join(', ')}.`;
        }

        return {
            is_sufficient,
            completeness_level,
            study_type_detected,
            available_context,
            missing_critical,
            missing_recommended,
            reasoning: `Rule-based assessment: ${is_sufficient ? 'Has organism and biological context' : 'Missing required fields'}`,
            user_message,
            suggestions: missing_critical.length > 0
                ? [`Provide ${missing_critical.join(' and ')}`]
                : ['Consider adding more details about the experimental design']
        };
    },

    /**
     * Helper function to clean LLM JSON responses
     */
    cleanLLMResponse(content) {
        let cleaned = content.trim();

        // Remove markdown code blocks
        if (cleaned.startsWith('```')) {
            cleaned = cleaned.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        }

        // Remove any leading/trailing whitespace
        cleaned = cleaned.trim();

        return cleaned;
    },

    /**
     * Consolidate metadata from all available sources using LLM
     */
    async 'analysis.consolidateMetadata'({analysisId, allAvailableData}) {
        check(analysisId, String);
        check(allAvailableData, Object);

        const { getDefaultLLM } = await import('../../llm/config.js');

        try {
            const llm = getDefaultLLM();

            const systemPrompt = `You are a biological data metadata expert. Your job is to extract and consolidate ALL biological context from the provided information.

AVAILABLE SOURCES:
1. Uploaded metadata files (txt, json, md)
2. User-entered experimental context text
3. Analysis file names
4. Pathway database selections
5. Any other available information

EXTRACT AND STRUCTURE:
{
  "organism": "Scientific name (e.g., Homo sapiens, Mus musculus)",
  "tissue": "Tissue or cell type",
  "disease": "Disease or condition (if applicable, otherwise null)",
  "experimental_context": "Detailed description of experiment/treatment/exposure",
  "comparison": "What is being compared (e.g., treatment vs control)",
  "study_type": "disease_study|treatment_study|exposure_study|developmental_study|other",
  "additional_metadata": {
    // Any other relevant fields like strain, age, sex, platform, etc.
  }
}

RULES:
- Extract only explicitly stated information
- If disease is not applicable (e.g., healthy mice with treatment), set disease: null
- Be comprehensive but accurate
- Normalize terms (e.g., "ccRCC" → "Clear Cell Renal Cell Carcinoma")
- Include study design details in experimental_context
- If organism is not specified but you can infer from context (e.g., TCGA = human), include it
- If tissue is not specified, set to null

Return ONLY the JSON object, no markdown code blocks or extra text.`;

            const userPrompt = `Consolidate metadata from these sources:

METADATA FILE CONTENT:
${allAvailableData.metadataText || 'None'}

USER DESCRIPTION:
${allAvailableData.customContext || 'None'}

ANALYSIS NAME:
${allAvailableData.analysisName || 'None'}

FILE NAMES:
${allAvailableData.fileNames?.join(', ') || 'None'}

SELECTED PATHWAY DATABASES:
${allAvailableData.selectedDatabases?.join(', ') || 'None'}

Extract and consolidate all biological context.`;

            const response = await llm.chat([
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt }
            ]);

            // Parse the LLM response
            let consolidated = {};
            try {
                const cleaned = Meteor.call('cleanLLMResponse', response.content);
                consolidated = JSON.parse(cleaned);
            } catch (parseError) {
                console.error('Failed to parse LLM consolidation response:', parseError);
                // Return minimal structure
                consolidated = {
                    organism: 'Homo sapiens',
                    tissue: null,
                    disease: null,
                    experimental_context: allAvailableData.customContext || '',
                    comparison: '',
                    study_type: 'other',
                    additional_metadata: {}
                };
            }

            return {
                consolidated,
                confidence: 'high',
                sources_used: Object.keys(allAvailableData).filter(k => allAvailableData[k]),
                model: response.model || 'unknown'
            };
        } catch (error) {
            console.error('LLM consolidation failed:', error);

            // Fallback: return basic structure from available data
            return {
                consolidated: {
                    organism: 'Homo sapiens',
                    tissue: null,
                    disease: null,
                    experimental_context: allAvailableData.customContext || '',
                    comparison: '',
                    study_type: 'other',
                    additional_metadata: {}
                },
                confidence: 'low',
                sources_used: [],
                fallback: true,
                error: error.message
            };
        }
    },

    /**
     * Assess if metadata is sufficient for AI interpretation
     */
    async 'analysis.assessMetadataCompleteness'({metadata, analysisType}) {
        check(metadata, Object);
        check(analysisType, String);

        const { getDefaultLLM } = await import('../../llm/config.js');

        try {
            const llm = getDefaultLLM();

            const systemPrompt = `You are a biological data quality expert. Assess if the provided metadata contains SUFFICIENT biological context for AI-powered pathway interpretation.

CONTEXT: The metadata will be used to:
1. Contextualize pathway enrichment results
2. Validate findings against disease/tissue-specific literature
3. Generate mechanistic explanations
4. Identify therapeutic implications
5. Fact-check biological claims

ASSESSMENT CRITERIA:
- Can the LLM understand WHAT biological system is being studied?
- Can the LLM understand WHAT comparison is being made?
- Can the LLM find relevant scientific literature?
- Is there enough context to generate meaningful interpretations?

STUDY TYPES TO CONSIDER:
- Disease studies: Need disease + tissue context
- Treatment studies: Need treatment details + comparison
- Exposure studies: Need exposure details + comparison
- Developmental studies: Need stage/timepoint + comparison

Respond in JSON:
{
  "is_sufficient": true/false,
  "completeness_level": "minimal|good|excellent",
  "study_type_detected": "disease|treatment|exposure|developmental|other",
  "available_context": ["list", "of", "available", "fields"],
  "missing_critical": ["list", "of", "critical", "missing", "fields"],
  "missing_recommended": ["list", "of", "recommended", "missing", "fields"],
  "reasoning": "Explain why sufficient/insufficient",
  "user_message": "Friendly message for user explaining what's needed",
  "suggestions": ["How to improve metadata quality"]
}

Return ONLY the JSON object, no markdown code blocks.`;

            const userPrompt = `Assess this metadata for pathway interpretation:

${JSON.stringify(metadata, null, 2)}

Analysis type: ${analysisType}

Is this sufficient for high-quality AI interpretation?`;

            const response = await llm.chat([
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt }
            ]);

            // Parse the LLM response
            try {
                const cleaned = Meteor.call('cleanLLMResponse', response.content);
                const assessment = JSON.parse(cleaned);
                return assessment;
            } catch (parseError) {
                console.error('Failed to parse assessment response:', parseError);
                console.error('Response was:', response.content);

                // Fallback: Use rule-based validation
                return Meteor.call('performRuleBasedAssessment', metadata, analysisType);
            }
        } catch (error) {
            console.error('Assessment failed:', error);

            // Last resort: Use rule-based validation
            return Meteor.call('performRuleBasedAssessment', metadata, analysisType);
        }
    },

    /**
     * Suggest metadata improvements based on assessment
     */
    async 'analysis.suggestMetadataImprovements'({currentMetadata, assessment}) {
        check(currentMetadata, Object);
        check(assessment, Object);

        const { getDefaultLLM } = await import('../../llm/config.js');

        try {
            const llm = getDefaultLLM();

            const systemPrompt = `You are a helpful research assistant. The user's metadata is incomplete for AI interpretation. Help them improve it.

Generate specific, actionable suggestions based on what's missing.

Respond in JSON:
{
  "quick_questions": [
    {
      "question": "What disease or condition are you studying?",
      "field": "disease",
      "examples": ["Kidney Cancer (KIRC)", "Alzheimer's Disease", "Not applicable - healthy samples"],
      "required": true
    }
  ],
  "template_suggestions": [
    {
      "scenario": "TCGA cancer study",
      "template": "RNA-seq analysis of [DISEASE] comparing [TUMOR TYPE] vs [NORMAL TYPE] tissue"
    }
  ],
  "what_to_include": "Explain what biological context would help AI interpretation",
  "where_to_find_it": "Suggest where user can find this information (paper abstract, GEO description, etc.)"
}

Return ONLY the JSON object, no markdown code blocks.`;

            const userPrompt = `Current metadata:
${JSON.stringify(currentMetadata, null, 2)}

Assessment:
${JSON.stringify(assessment, null, 2)}

Help user improve their metadata with specific questions and templates.`;

            const response = await llm.chat([
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt }
            ]);

            // Parse the LLM response
            try {
                const cleaned = Meteor.call('cleanLLMResponse', response.content);
                const suggestions = JSON.parse(cleaned);
                return suggestions;
            } catch (parseError) {
                console.error('Failed to parse suggestions response:', parseError);
                console.error('Response was:', response.content);

                // Fallback suggestions
                return {
                    quick_questions: [
                        {
                            question: 'What organism/species is this study on?',
                            field: 'organism',
                            examples: ['Homo sapiens', 'Mus musculus', 'Rattus norvegicus'],
                            required: true
                        },
                        {
                            question: 'What tissue or cell type was analyzed?',
                            field: 'tissue',
                            examples: ['kidney', 'brain', 'liver', 'blood'],
                            required: false
                        },
                        {
                            question: 'What comparison is being made?',
                            field: 'comparison',
                            examples: ['tumor vs normal', 'treated vs control', 'disease vs healthy'],
                            required: true
                        }
                    ],
                    template_suggestions: [
                        {
                            scenario: 'Disease study',
                            template: 'RNA-seq analysis of [DISEASE] in [TISSUE] tissue, comparing [CONDITION] vs [CONTROL]'
                        },
                        {
                            scenario: 'Treatment study',
                            template: '[TREATMENT] exposure study in [ORGANISM] [TISSUE], comparing treated vs control'
                        }
                    ],
                    what_to_include: 'Include information about the biological system, experimental design, and comparison being made.',
                    where_to_find_it: 'Check the publication abstract, GEO/SRA description, or experimental protocol for this information.'
                };
            }
        } catch (error) {
            console.error('Suggestions generation failed:', error);
            throw new Meteor.Error('suggestions-failed', error.message);
        }
    }
});

// Mass Analysis Methods
Meteor.methods({
    async 'massAnalysis.create'({
                                    massAnalysisId,
                                    sessionId,
                                    analyses,
                                    groups,
                                    groupConfigs,
                                    individualOverrides,
                                    defaultConfig = {},
                                    globalOrganism
                                }) {
        // Pushes entries into the target session's analyses[] — the array the ownership guards
        // read — and queues R work against it, so it cannot accept an arbitrary sessionId. The
        // per-analysis ids below are minted server-side with Random.id(), so no caller-supplied id
        // enters that array through this path.
        await assertWritableSession({sessionId, requesterUserId: this.userId});
        console.log('Creating mass analysis:', massAnalysisId);

        // Extract metadata from analyses
        const analysesMetadata = {};
        analyses.forEach(analysis => {
            if (analysis.metadata) {
                analysesMetadata[analysis.name] = analysis.metadata;
            }
        });

        // Create mass analysis record with enhanced group and metadata information
        await DBCollections.MassAnalysisQueue.insertAsync({
            _id: massAnalysisId,
            sessionId,
            status: 'pending',
            total: analyses.filter(analysis => !analysis.error).length,
            completed: 0,
            failed: 0,
            createdAt: new Date(),
            currentAnalysis: null,
            groups: groups, // Enhanced with descriptions
            groupConfigs: groupConfigs,
            defaultConfig: defaultConfig,
            globalOrganism: globalOrganism,
            analysesMetadata: analysesMetadata // Store metadata for each dataset
        });

        // Rest of the method remains the same...
        const createdAnalyses = [];
        const analysisGroupMap = {};

        Object.values(groups).forEach(group => {
            group.analyses.forEach(analysisName => {
                analysisGroupMap[analysisName] = group.id;
            });
        });

        // Filter out analyses with errors first
        const validAnalyses = analyses.filter(analysis => !analysis.error);
        analyses.filter(analysis => analysis.error).forEach(analysis => {
            console.log(`Skipping analysis ${analysis.name} due to error: ${analysis.error}`);
        });

        // Helper function to create a single analysis
        const createSingleAnalysis = async (analysis) => {
            try {
                const analysisId = Random.id();
                const groupId = analysisGroupMap[analysis.name];
                const group = groups[groupId];
                const individualOverride = individualOverrides[analysis.name] || {};

                let finalConfig;
                let newAnalysis;

                if (groupId && group) {
                    const groupConfig = groupConfigs[groupId];

                    if (!groupConfig) {
                        throw new Error(`No group configuration found for analysis: ${analysis.name}`);
                    }

                    finalConfig = {
                        organism: globalOrganism,
                        selectedDatasets: groupConfig.selectedDatasets,
                        methodSettings: groupConfig.methodSettings
                    };

                    newAnalysis = {
                        id: analysisId,
                        name: analysis.name,
                        input: analysis.inputType,
                        isMassAnalysis: true,
                        massAnalysisId,
                        groupId: groupId,
                        groupName: group.name,
                        groupDescription: group.description || '',
                        groupColor: getInputTypeColor(analysis.inputType),
                        metadata: analysis.metadata || ''
                    };
                } else {
                    const inputType = analysis.inputType;
                    let typeConfig = defaultConfig.inputTypeConfigs?.[inputType];

                    if (!typeConfig) {
                        typeConfig = {
                            organism: globalOrganism,
                            selectedDatasets: defaultConfig.selectedDatasets || [],
                            methodSettings: defaultConfig.methodSettings || {}
                        };
                    }

                    finalConfig = {
                        organism: globalOrganism,
                        selectedDatasets: typeConfig.selectedDatasets,
                        methodSettings: typeConfig.methodSettings
                    };

                    newAnalysis = {
                        id: analysisId,
                        name: analysis.name,
                        input: analysis.inputType,
                        isMassAnalysis: true,
                        massAnalysisId,
                        groupColor: getInputTypeColor(analysis.inputType),
                        metadata: analysis.metadata || ''
                    };
                }

                // Register the analysis on the session BEFORE configuring it. configureAnalysisData
                // drives analysis.update, whose ownership guard resolves an analysisId by looking
                // it up in Session.analyses[] — so configuring first meant the guard could not yet
                // see the analysis and every creation failed into the catch below, silently
                // producing a mass analysis with zero analyses.
                await DBCollections.Session.updateAsync(sessionId, {
                    $push: {analyses: newAnalysis}
                });

                try {
                    // Configure analysis data and create queue item
                    await configureAnalysisData(analysisId, analysis, finalConfig, individualOverride);

                    await DBCollections.MassAnalysisQueueItem.insertAsync({
                        _id: Random.id(),
                        massAnalysisId,
                        analysisId,
                        analysisName: analysis.name,
                        inputType: analysis.inputType,
                        groupId: groupId || null,
                        groupName: group?.name || null,
                        status: 'pending',
                        createdAt: new Date(),
                        priority: 1
                    });
                } catch (configError) {
                    // Undo the registration so a failed analysis leaves nothing behind, matching
                    // the previous behaviour where it was simply never added.
                    await DBCollections.Session.updateAsync(sessionId, {
                        $pull: {analyses: {id: analysisId}}
                    });
                    throw configError;
                }

                return newAnalysis;

            } catch (error) {
                console.error(`Error creating analysis ${analysis.name}:`, error);
                return null;
            }
        };

        // Process analyses in batches of 5 for better performance
        const BATCH_SIZE = 5;
        for (let i = 0; i < validAnalyses.length; i += BATCH_SIZE) {
            const batch = validAnalyses.slice(i, i + BATCH_SIZE);
            console.log(`📦 Creating batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(validAnalyses.length / BATCH_SIZE)} (${batch.length} analyses)`);

            const batchPromises = batch.map(analysis => createSingleAnalysis(analysis));
            const batchResults = await Promise.all(batchPromises);

            // Add successful creations to the result array
            batchResults.forEach(result => {
                if (result !== null) {
                    createdAnalyses.push(result);
                }
            });
        }

        // Process queue items
        const queueItems = await DBCollections.MassAnalysisQueueItem.find({massAnalysisId}).countAsync();
        if (queueItems > 0) {
            await processQueueItems(massAnalysisId);
        } else {
            await DBCollections.MassAnalysisQueue.updateAsync(massAnalysisId, {
                $set: {status: 'completed', completedAt: new Date()}
            });
        }

        return {success: true, createdAnalyses};
    },

    async 'massAnalysis.getProgress'({massAnalysisId}) {
        await assertOwnsMassAnalysis({massAnalysisId, requesterUserId: this.userId});
        return await DBCollections.MassAnalysisQueue.findOneAsync(massAnalysisId);
    },

    async 'massAnalysis.getQueueItems'({massAnalysisId}) {
        await assertOwnsMassAnalysis({massAnalysisId, requesterUserId: this.userId});
        return await DBCollections.MassAnalysisQueueItem.find(
            {massAnalysisId},
            {sort: {createdAt: 1}}
        ).fetchAsync();
    },

    // Get analyses grouped by their mass analysis groups
    async 'massAnalysis.getGroupedAnalyses'({sessionId}) {
        // Returns session.analyses entries directly, so an unguarded call turned a copied
        // sessionId into the list of analysisIds needed to read the rest of the study.
        const session = await assertOwnsSession({sessionId, requesterUserId: this.userId});

        // Get all mass analyses for this session
        const massAnalyses = await DBCollections.MassAnalysisQueue.find({
            sessionId,
            status: 'completed'
        }).fetchAsync();

        const groupedAnalyses = [];

        for (const massAnalysis of massAnalyses) {
            if (massAnalysis.groups) {
                Object.values(massAnalysis.groups).forEach(group => {
                    const analysesInGroup = session.analyses.filter(analysis =>
                        analysis.isMassAnalysis &&
                        analysis.massAnalysisId === massAnalysis._id &&
                        group.analyses.includes(analysis.name)
                    );

                    if (analysesInGroup.length > 0) {
                        groupedAnalyses.push({
                            groupId: group.id,
                            groupName: group.name,
                            inputType: group.inputType,
                            analyses: analysesInGroup,
                            isCollapsed: true // Default to collapsed in UI
                        });
                    }
                });
            }
        }

        return groupedAnalyses;
    },
    async 'massAnalysis.getMetadata'({massAnalysisId}) {
        await assertOwnsMassAnalysis({massAnalysisId, requesterUserId: this.userId});
        const massAnalysis = await DBCollections.MassAnalysisQueue.findOneAsync(massAnalysisId);
        return massAnalysis?.analysesMetadata || {};
    },

    async 'massAnalysis.getGroupedAnalysesWithMetadata'({sessionId}) {
        const session = await assertOwnsSession({sessionId, requesterUserId: this.userId});

        const massAnalyses = await DBCollections.MassAnalysisQueue.find({
            sessionId,
            status: 'completed'
        }).fetchAsync();

        const groupedAnalyses = [];

        for (const massAnalysis of massAnalyses) {
            if (massAnalysis.groups) {
                Object.values(massAnalysis.groups).forEach(group => {
                    const analysesInGroup = session.analyses.filter(analysis =>
                        analysis.isMassAnalysis &&
                        analysis.massAnalysisId === massAnalysis._id &&
                        group.analyses.includes(analysis.name)
                    );

                    if (analysesInGroup.length > 0) {
                        groupedAnalyses.push({
                            groupId: group.id,
                            groupName: group.name,
                            groupDescription: group.description || '', // Include description
                            inputType: group.inputType,
                            analyses: analysesInGroup,
                            metadata: massAnalysis.analysesMetadata || {}, // Include metadata
                            isCollapsed: true
                        });
                    }
                });
            }
        }

        return groupedAnalyses;
    }
});

async function configureAnalysisData(analysisId, analysis, finalConfig, individualOverride = {}) {
    const inputType = analysis.inputType;
    const data = analysis.data;

    // Apply individual overrides to final config
    const appliedConfig = {
        organism: finalConfig.organism, // Always use global organism
        selectedDatasets: individualOverride.selectedDatasets || finalConfig.selectedDatasets,
        methodSettings: individualOverride.methodSettings ?
            {...finalConfig.methodSettings, ...individualOverride.methodSettings} :
            finalConfig.methodSettings
    };

    // Set basic configuration with applied overrides
    await Meteor.callAsync('analysis.update', {
        analysisId,
        inputType,
        data: {
            taxId: appliedConfig.organism,
            selectedDatasets: appliedConfig.selectedDatasets,
            methodSettings: appliedConfig.methodSettings
        }
    });

    // Set input data based on type
    switch (inputType) {
        case 'ora':
            await Meteor.callAsync('analysis.update', {
                analysisId,
                inputType,
                data: {
                    input: data.input,
                    background: data.background || '',
                    taxId: appliedConfig.organism
                }
            });
            break;

        case 'pgsea':
            await Meteor.callAsync('analysis.update', {
                analysisId,
                inputType,
                data: {
                    // `content` is already ranked by the selected column client-side
                    // (see MassAnalysisModal buildPgseaContent); this is metadata only.
                    input: data.content,
                    rankingBy: data.rankingBy || 'fc',
                    taxId: appliedConfig.organism
                }
            });
            break;

        case 'expression':
            if (data.expressionFileName && data.groupFileName) {
                // Upload expression file
                await Meteor.callAsync('analysis.update', {
                    analysisId,
                    inputType,
                    data: {
                        expressionFile: data.expressionFileName,
                        taxId: appliedConfig.organism
                    }
                });

                // Upload group file
                await Meteor.callAsync('analysis.update', {
                    analysisId,
                    inputType,
                    data: {
                        groupFile: data.groupFileName
                    }
                });
            } else {
                throw new Error(`Missing expression or group filenames for analysis ${analysis.name}`);
            }
            break;
    }

    console.log(`Configured analysis ${analysis.name} with:`, {
        organism: appliedConfig.organism,
        databases: appliedConfig.selectedDatasets?.length || 0,
        methods: Object.keys(appliedConfig.methodSettings || {}).filter(m => appliedConfig.methodSettings[m]?.enabled)
    });
}

// Queue processing function - remains the same
async function processQueueItems(massAnalysisId) {
    try {
        await DBCollections.MassAnalysisQueue.updateAsync(massAnalysisId, {
            $set: {status: 'running'}
        });

        const maxConcurrent = Meteor.settings.private?.massAnalysisMaxConcurrent || 5;
        const queueItems = await DBCollections.MassAnalysisQueueItem.find(
            {massAnalysisId, status: 'pending'},
            {sort: {priority: -1, createdAt: 1}}
        ).fetchAsync();

        // Process items in batches
        for (let i = 0; i < queueItems.length; i += maxConcurrent) {
            const batch = queueItems.slice(i, i + maxConcurrent);

            // Process batch concurrently
            await Promise.all(batch.map(async (item) => {
                try {
                    await processQueueItem(item);
                } catch (error) {
                    console.error(`Error processing queue item ${item._id}:`, error);
                    await DBCollections.MassAnalysisQueueItem.updateAsync(item._id, {
                        $set: {
                            status: 'failed',
                            error: error.message,
                            completedAt: new Date()
                        }
                    });

                    await DBCollections.MassAnalysisQueue.updateAsync(massAnalysisId, {
                        $inc: {failed: 1}
                    });
                }
            }));
        }

        // Update final status
        const finalProgress = await DBCollections.MassAnalysisQueue.findOneAsync(massAnalysisId);
        const allCompleted = finalProgress.completed + finalProgress.failed >= finalProgress.total;

        if (allCompleted) {
            await DBCollections.MassAnalysisQueue.updateAsync(massAnalysisId, {
                $set: {
                    status: 'completed',
                    completedAt: new Date(),
                    currentAnalysis: null
                }
            });
        }

    } catch (error) {
        console.error(`Error processing queue for mass analysis ${massAnalysisId}:`, error);
        await DBCollections.MassAnalysisQueue.updateAsync(massAnalysisId, {
            $set: {
                status: 'error',
                error: error.message
            }
        });
    }
}

// Process individual queue item - remains the same
async function processQueueItem(queueItem) {
    try {
        await DBCollections.MassAnalysisQueueItem.updateAsync(queueItem._id, {
            $set: {
                status: 'running',
                startedAt: new Date()
            }
        });

        await DBCollections.MassAnalysisQueue.updateAsync(queueItem.massAnalysisId, {
            $set: {currentAnalysis: queueItem.analysisName}
        });

        // Run the actual analysis. Mass analyses run entirely server-side (no
        // browser), so the wizard's client-side consensus trigger never fires
        // for them — decide here whether consensus will run, so analysis.start
        // can defer the final completion to it (keeps the run from flashing
        // 100% then dropping back to 95% for anyone viewing the result).
        const sessionId = (await DBCollections.MassAnalysisQueue.findOneAsync(queueItem.massAnalysisId)).sessionId;
        const methodSettingsDoc = await DBCollections.AnalysisConfig.findOneAsync({
            analysisId: queueItem.analysisId,
            inputType: queueItem.inputType,
            key: 'methodSettings'
        });
        const willRunConsensus = shouldRunConsensusForConfigDoc(methodSettingsDoc, queueItem.inputType);

        await Meteor.callAsync('analysis.start', {
            analysisId: queueItem.analysisId,
            inputType: queueItem.inputType,
            sessionId,
            deferCompletion: willRunConsensus
        });

        // Trigger consensus with the same gate (consensus enabled AND >1 method).
        // A consensus failure must not fail the queue item — the per-method
        // enrichment has already succeeded.
        if (willRunConsensus) {
            try {
                await Meteor.callAsync('consensus.processAnalysis', {
                    analysisId: queueItem.analysisId,
                    sessionId,
                    inputType: queueItem.inputType
                });
            } catch (consensusErr) {
                console.error(`Consensus step failed for mass analysis item ${queueItem.analysisId}:`, consensusErr);
            }
        }

        // Mark as completed
        await DBCollections.MassAnalysisQueueItem.updateAsync(queueItem._id, {
            $set: {
                status: 'completed',
                completedAt: new Date()
            }
        });

        await DBCollections.MassAnalysisQueue.updateAsync(queueItem.massAnalysisId, {
            $inc: {completed: 1}
        });

    } catch (error) {
        throw error;
    }
}

// Helper function to get color for input type
function getInputTypeColor(inputType) {
    const colors = {
        ora: '#1890ff',     // Blue
        pgsea: '#52c41a',   // Green
        expression: '#fa8c16' // Orange
    };
    return colors[inputType] || '#666666';
}

// Queue monitoring methods - remain the same
Meteor.methods({
    async 'massAnalysis.queue.getStatus'() {
        // `recent` returns whole MassAnalysisQueue documents — sessionIds, analysesMetadata,
        // currentAnalysis — across every user, so this is operator-only. It has no call site in the
        // app; the check is here rather than deleting the method outright.
        // isAdmin, not checkAdmin: the latter uses the sync Meteor.users.findOne, which the Meteor 3
        // server driver no longer provides.
        await Permission.isAdmin(this.userId);

        const running = await DBCollections.MassAnalysisQueue.find({
            status: {$in: ['pending', 'running']}
        }).countAsync();

        const recent = await DBCollections.MassAnalysisQueue.find(
            {},
            {sort: {createdAt: -1}, limit: 10}
        ).fetchAsync();

        return {running, recent};
    },

    async 'massAnalysis.queue.retry'({massAnalysisId}) {
        // Untyped id plus {multi: true} made this a platform-wide queue reset.
        await assertOwnsMassAnalysis({massAnalysisId, requesterUserId: this.userId});
        // Retry failed items
        await DBCollections.MassAnalysisQueueItem.updateAsync(
            {massAnalysisId, status: 'failed'},
            {$set: {status: 'pending', error: null}},
            {multi: true}
        );

        await DBCollections.MassAnalysisQueue.updateAsync(massAnalysisId, {
            $set: {status: 'pending'},
            $unset: {error: 1}
        });

        // Restart processing
        await processQueueItems(massAnalysisId);
    }
});

export {
    getMappedGeneIds
}