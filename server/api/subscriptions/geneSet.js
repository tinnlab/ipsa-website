import {Meteor} from 'meteor/meteor'

Meteor.publish({
    'geneSet.aggregation.all'({databaseId}) {
        return DBCollections.GeneSetAggregation.find({database : databaseId})
    }
});
