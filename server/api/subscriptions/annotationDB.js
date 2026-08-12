import {Meteor} from 'meteor/meteor'

Meteor.publish({
    'annotationDB.fetch'() {
        return DBCollections.AnnotationDB.find()
    }
});
