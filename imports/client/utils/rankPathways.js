export default {
    rankPathwaysByCriteria: (results, rankingCriteria, numberPathwaySelected) => {
        let methodData = {};
        results.forEach(obj => {
            const { key, value } = obj;
            methodData[key] = value.map(pathway => ({
                pathway: pathway.pathway,
                [rankingCriteria]: pathway[rankingCriteria]
            }));
        });

        Object.values(methodData).forEach(pathways => {
            pathways.sort((a, b) => a[rankingCriteria] - b[rankingCriteria]);
            pathways.forEach((pathway, index) => {
                pathway.rank = index + 1;
            });
        });

        let pathwayRanks = {};
        Object.values(methodData).forEach(pathways => {
            pathways.forEach(pathway => {
                const { pathway: pathwayName, rank } = pathway;
                if (!pathwayRanks[pathwayName]) {
                    pathwayRanks[pathwayName] = [];
                }
                pathwayRanks[pathwayName].push(rank);
            });
        });

        let pathwayAverageRanks = Object.entries(pathwayRanks).map(([pathway, ranks]) => ({
            pathway,
            averageRank: ranks.reduce((sum, rank) => sum + rank, 0) / ranks.length
        }));
        pathwayAverageRanks.sort((a, b) => a.averageRank - b.averageRank);

        return pathwayAverageRanks.slice(0, numberPathwaySelected).map(pathway => pathway.pathway);
    },
    rankPathwaysObjectByCriteria: (results, rankingCriteria, numberPathwaySelected) => {
        let methodData = {};
        Object.entries(results).forEach(obj => {
            // const { key, value } = obj;
            methodData[obj[0]] = obj[1].map(pathway => ({
                pathway: pathway.id,
                [rankingCriteria]: pathway[rankingCriteria]
            }));
        });


        Object.values(methodData).forEach(pathways => {
            pathways.sort((a, b) => a[rankingCriteria] - b[rankingCriteria]);
            pathways.forEach((pathway, index) => {
                pathway.rank = index + 1;
            });
        });
        let pathwayRanks = {};
        Object.values(methodData).forEach(pathways => {
            pathways.forEach(pathway => {
                const { pathway: pathwayId, rank } = pathway;
                if (!pathwayRanks[pathwayId]) {
                    pathwayRanks[pathwayId] = [];
                }
                pathwayRanks[pathwayId].push(rank);
            });
        });
        let pathwayAverageRanks = Object.entries(pathwayRanks).map(([pathway, ranks]) => ({
            pathway,
            averageRank: ranks.reduce((sum, rank) => sum + rank, 0) / ranks.length
        }));
        pathwayAverageRanks.sort((a, b) => a.averageRank - b.averageRank);
        return pathwayAverageRanks.slice(0, numberPathwaySelected).map(pathway => pathway.pathway);
    },
    rankPathwaysObjectByCriteriaMultiAnalysis: (results, rankingCriteria, numberPathwaySelected) => {
        let methodData = {};
        Object.entries(results).forEach(obj => {
            // const { key, value } = obj;
            methodData[obj[0]] = obj[1].map(pathway => ({
                pathway: pathway.pathway,
                [rankingCriteria]: pathway[rankingCriteria]
            }));
        });
        Object.values(methodData).forEach(pathways => {
            pathways.sort((a, b) => a[rankingCriteria] - b[rankingCriteria]);
            pathways.forEach((pathway, index) => {
                pathway.rank = index + 1;
            });
        });
        let pathwayRanks = {};
        Object.values(methodData).forEach(pathways => {
            pathways.forEach(pathway => {
                const { pathway: pathwayId, rank } = pathway;
                if (!pathwayRanks[pathwayId]) {
                    pathwayRanks[pathwayId] = [];
                }
                pathwayRanks[pathwayId].push(rank);
            });
        });
        let pathwayAverageRanks = Object.entries(pathwayRanks).map(([pathway, ranks]) => ({
            pathway,
            averageRank: ranks.reduce((sum, rank) => sum + rank, 0) / ranks.length
        }));
        pathwayAverageRanks.sort((a, b) => a.averageRank - b.averageRank);
        return pathwayAverageRanks.slice(0, numberPathwaySelected).map(pathway => pathway.pathway);
    }
}