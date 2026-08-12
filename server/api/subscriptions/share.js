import {Meteor} from 'meteor/meteor';

// Progress for the recipient's own in-flight import. Scoped to this.userId: the document records
// which share was used and which study it produced, neither of which belongs to anyone else.
Meteor.publish('share.import.progress', async function (progressId) {
    if (!this.userId || typeof progressId !== 'string' || !progressId) {
        return this.ready();
    }
    return DBCollections.ShareImportProgress.find({_id: progressId, userId: this.userId});
});
