import _ from 'lodash';
import {buildDEGenesCsv, buildTableCsv, mergeSymbolsIntoRows} from '/imports/utils/exportUtils';
import {mergePendingUpdateData} from '/imports/utils/pendingUpdateUtils';

// Trigger a browser download of a CSV string. Prepends a UTF-8 BOM so Excel
// recognises the encoding, then uses the standard Blob + <a download> pattern.
const downloadCsv = (csv, fileName) => {
    // Add BOM for Excel to properly recognize UTF-8
    const BOM = '﻿';
    const blob = new Blob([BOM + csv], {type: 'text/csv;charset=utf-8'});
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', fileName);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
};

export default {
    updateAnalysis: (() => {
        let dataToUpdate = {}
        const updateFunc = _.debounce(async (analysisId) => {
            const session = await DBCollections.Session.findOneAsync(
                {"analyses.id": analysisId}
            );
            console.log("session", session)
            if (!session.editable)
                return
            let data = dataToUpdate[analysisId];
            console.log("update analysis", analysisId, data);
            if (data) {
                delete dataToUpdate[analysisId];
                // console.log("update analysis", analysisId, data.inputType);
                let result = await Meteor.asyncCallWithNotification("analysis.update", {
                    analysisId, inputType: data.inputType, data: data.data
                })

                // The rows the method just upserted used to be written back into the local
                // collection from here. That was a direct client write, only possible because the
                // `insecure` package was still installed, and it is redundant: analysis.update has
                // already persisted them server-side and the analysis.config subscription pushes
                // the same documents into minimongo. Client writes are now denied outright
                // (server/startup/lockdown.js), so the loop would only throw.
                return result
            }
        })

        return async ({analysisId, inputType, data}) => {
            dataToUpdate[analysisId] = {
                inputType,
                data: mergePendingUpdateData(dataToUpdate[analysisId], data)
            }
            // console.log("update analysis", analysisId, dataToUpdate[analysisId]);
            return await updateFunc(analysisId);
        }
    })(),
    readFile: async (file) => {
        return await new Promise(r => {
            let reader = new FileReader();
            reader.onload = function (event) {
                r(event.target.result)
            };
            reader.readAsText(file);
        })
    },
    parseCSV: (text, d = ',') => {
        const lines = text.split('\n');
        const output = [];

        lines.forEach(line => {
            line = line.trim();

            if (line.length === 0) return;

            const skipIndexes = {};
            const columns = line.split(d);

            output.push(columns.reduce((result, item, index) => {
                if (skipIndexes[index]) return result;

                if (item.startsWith('"') && !item.endsWith('"')) {
                    while (!columns[index + 1].endsWith('"')) {
                        index++;
                        item += `,${columns[index]}`;
                        skipIndexes[index] = true;
                    }

                    index++;
                    skipIndexes[index] = true;
                    item += `,${columns[index]}`;
                }

                result.push(item);
                return result;
            }, []));
        });
        return output;
    },
    exportTable: ({tableData, activeTab}) => {
        console.log(activeTab)
        const db = tableData[activeTab];
        const csv = buildTableCsv({
            rows: db.geneSets,
            columns: [
                {header: 'ID', field: 'id'},
                {header: 'Name', field: 'name'},
                {header: '#Genes', field: 'genes'},
                {header: '#Background genes', field: 'background'},
                {header: '#Common genes', field: 'common'},
            ],
        });
        downloadCsv(csv, `${db.name}.csv`);
    },
    exportDEGenes: ({deGenesData, inputType, fileName = 'DEGenes.csv'}) => {
        // Build CSV with full numeric precision (see buildDEGenesCsv). The old
        // implementation rounded p-value/Log2FC to 2 decimals, turning small
        // p-values into "0.00".
        const csv = buildDEGenesCsv({deGenesData, inputType});
        downloadCsv(csv, fileName);
    },
    // Generic whole-table CSV export. `columns` is [{header, field, format?}]
    // (see buildTableCsv). Used by the DE-gene tables (Venn, AI-form, heatmaps).
    exportTableCsv: ({rows, columns, fileName = 'table.csv'}) => {
        downloadCsv(buildTableCsv({rows, columns}), fileName);
    },
    // Ensure every row has a gene symbol. Rows already carrying a symbol are left
    // as-is; for the rest we look the symbol up via `visualization.getGeneInfo`
    // (the canonical Entrez-ID -> symbol/description resolver) and merge it in.
    // Returns a new array; on lookup failure it returns the rows unchanged so the
    // export still proceeds (with whatever symbols were already present).
    ensureGeneSymbols: async (rows, {idField = 'id', symbolField = 'symbol'} = {}) => {
        const list = Array.isArray(rows) ? rows : [];
        const hasValue = (v) => v !== null && v !== undefined && v !== '';
        // GeneInfo._id is stored as a string, but some ids arrive numeric (e.g.
        // meta-analysis rows), so coerce to string for the {_id: {$in}} lookup.
        // mergeSymbolsIntoRows already String()-coerces both sides when matching.
        const missingIds = [...new Set(
            list
                .filter(row => !hasValue(row?.[symbolField]) && hasValue(row?.[idField]))
                .map(row => String(row[idField]))
        )];
        if (missingIds.length === 0) return list;
        try {
            const geneInfoDocs = await Meteor.callAsync('visualization.getGeneInfo', missingIds);
            return mergeSymbolsIntoRows(list, geneInfoDocs, {idField, symbolField});
        } catch (error) {
            console.error('ensureGeneSymbols: getGeneInfo lookup failed', error);
            return list;
        }
    },
    detectGMTFormat: async function(file) {
        const content = await this.readFile(file);
        const lines = this.parseCSV(content, '\t');

        if (lines.length === 0) return { isStandard: false, error: 'Empty file', needsUserInput: false };

        const firstRow = lines[0];
        const sampleRows = lines.slice(0, Math.min(5, lines.length)); // Check first 5 rows

        // Analysis criteria
        const analysis = {
            columnCount: firstRow.length,
            secondColumnLooksLikeDescription: false,
            secondColumnLooksLikeGene: false,
            hasEmptyColumns: false,
            sampleData: {
                row1: firstRow,
                totalRows: lines.length
            }
        };

        // Check second column across sample rows
        for (const row of sampleRows) {
            const col2 = row[1] || '';

            // Check if column 2 looks like a description (has special chars, hierarchy markers)
            if (col2.includes('>') || col2.includes('†') || col2.includes('/') || col2.length > 50) {
                analysis.secondColumnLooksLikeDescription = true;
            }

            // Check if column 2 looks like a gene symbol (short, alphanumeric, no spaces)
            if (col2.length > 0 && col2.length < 20 && /^[A-Z0-9_-]+$/i.test(col2)) {
                analysis.secondColumnLooksLikeGene = true;
            }

            // Check for many empty columns (from trailing tabs)
            const emptyCols = row.filter(c => c.trim() === '').length;
            if (emptyCols > row.length * 0.3) { // More than 30% empty
                analysis.hasEmptyColumns = true;
            }
        }

        // Determine if standard format
        const isStandard = !analysis.secondColumnLooksLikeDescription &&
                           !analysis.hasEmptyColumns;

        return {
            isStandard,
            needsUserInput: !isStandard,
            analysis,
            suggestion: isStandard ? 'standard' : 'custom'
        };
    },
    async parseGMTFile (file, config = { pathwayNameColumn: 0, pathwayIdColumn: null, genesStartColumn: 2 }) {
        let fileContent = await this.readFile(file);
        let data = this.parseCSV(fileContent, '\t')

        return data.map(row => {
            // Get pathway name from specified column
            const pathwayName = row[config.pathwayNameColumn]?.replace(/"/g, '').trim() || 'Unknown';

            // Get pathway ID (use name if no separate ID column)
            const pathwayId = config.pathwayIdColumn !== null
                ? row[config.pathwayIdColumn]?.replace(/"/g, '').trim()
                : pathwayName;

            // Extract genes from specified start column onwards
            const genes = row.slice(config.genesStartColumn)
                .map(g => g?.replace(/"/g, '').trim())
                .filter(g => g && g.length > 0);

            return {
                id: pathwayId,
                name: pathwayName,
                genes: genes
            };
        })
    }
};