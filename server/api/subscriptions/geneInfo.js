import {Meteor} from 'meteor/meteor'

Meteor.publish({
    'geneInfo.fetch'({skip, limit, taxId, symbol}) {
        return DBCollections.GeneInfo.find({
            taxId: taxId || undefined,
            symbol: symbol || undefined
        }, {skip, limit})
    }
});
