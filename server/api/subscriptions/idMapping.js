import { Meteor } from 'meteor/meteor'

Meteor.publish({
    'idMapping.import.logs'() {
        return DBCollections.IDMappingLogs.find()
    }
});
