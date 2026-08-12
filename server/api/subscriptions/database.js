import {Meteor} from 'meteor/meteor'

Meteor.publish({
    'database.all'() {
        return DBCollections.Database.find()
    }
});
