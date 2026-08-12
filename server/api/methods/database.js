import {Meteor} from 'meteor/meteor'
import Permission from "../helper/Permission";
import {assertOwnsAnalysis} from "../../helper/ownership";

Meteor.methods({
    'database.update'(database) {
        Permission.checkAdmin(this.userId)
        DBCollections.Database.updateAsync(database._id, {
            $set: {version: database.version}
        })
    },
    'database.getAll'() {
        return DBCollections.Database.find({}, {
            fields: {
                _id: 1,
                name: 1,
                namespace: 1,
                version: 1
            }
        }).fetch();
    },
    async 'database.getSelectedDatasets'({ analysisId, sessionId }) {
        await assertOwnsAnalysis({ analysisId, requesterUserId: this.userId });
        const config = await DBCollections.AnalysisConfig.findOneAsync({ analysisId, key: 'selectedDatasets' });
        // const customGenesets = await DBCollections.SessionConfig.find({ sessionId, analysisId, key: 'customGeneSets' }).fetchAsync();
        // console.log('customGenesets', customGenesets);
        // if (customGenesets && customGenesets.length > 0 && config?.value.some(geneSet => customGenesets.map(e => e.id).includes(geneSet))) {
        //     config?.value.push(customGenesets.id)
        // }
        return config?.value || [];
    }
});
