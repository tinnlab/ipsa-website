import {Meteor} from 'meteor/meteor'

Meteor.publish({
    'idType.all'() {
        return DBCollections.IDType.find()
    },
    'idType.fetch'({source}) {
        return DBCollections.IDType.find({source})
    }
});
