export default {
    combineNormalWithMetaAnalyses: (normalAnalyses, metaAnalyses) => {
        // Filter for meta-analyses with completed pathway-level results
        // New structure: check pathwayLevel.status instead of type and status
        metaAnalyses = metaAnalyses.filter(e => {
            // Support both old and new structure for backward compatibility
            if (e.type === "Pathway" && e.status === "completed") {
                return true;
            }
            // New unified structure
            return e.pathwayLevel && e.pathwayLevel.status === "completed";
        });

        let metaAnalysesObj = metaAnalyses.reduce((acc, curr) => {
            acc[curr.id] = curr
            return acc
        }, {})

        Object.keys(metaAnalysesObj).forEach(key => {
            let metaAnalysis = metaAnalysesObj[key]
            normalAnalyses[key] = {
                id: metaAnalysis.id,
                name: metaAnalysis.name,
                input: "meta"
            }
        })
        return normalAnalyses
    },
    combineNormalAnalysisResultsWithMetaAnalysisResults: (analysisResultsByDb, metaData, dbId) => {
        metaData = metaData.filter(e => e.databaseId === dbId).map(e => {
            return {
                ...e,
                value: e.value.map(e => {
                    return {
                        pathway: e.ID.toString(),
                        score: e.normalizedScore,
                        pValue: e.pValue,
                        pValueFDR: e.pFDR
                    }
                }),
            }
        })
        return analysisResultsByDb.concat(metaData)
    },
    createTreeDataForAnalyses: (allAnalysisData, analyses) => {
        let resultGroupByAnalysis = allAnalysisData.reduce((acc, curr) => {
            if (!acc[curr.analysisId]) {
                acc[curr.analysisId] = []
            }
            acc[curr.analysisId].push(curr)
            return acc
        }, {})
        let initialTreeData = []
        let treeData = Object.keys(resultGroupByAnalysis).map((key) => {
            return {
                title: analyses[key]?.name,
                value: key,
                key: key,
                children: resultGroupByAnalysis[key].map((result) => {
                    initialTreeData.push(key + '_' + result.key)
                    return {
                        title: analyses[key]?.name + '_' + result.key.toUpperCase(),
                        value: key + '_' + result.key,
                        key: key + '_' + result.key
                    }
                })
            }
        })
        return {treeData, initialTreeData}
    }
}