import {Meteor} from 'meteor/meteor';
import {resolveInputTypePolicy} from '/imports/utils/inputTypePolicy';

Meteor.methods({
    // The input-type flags from Meteor.settings.private (see imports/utils/inputTypePolicy.js).
    // The client cannot read private settings, so this is how the wizard and the interpretation
    // pages learn them. Two booleans-worth of config, nothing secret, so not gated on this.userId:
    // the pages that ask race the asynchronous guest login.
    async 'inputTypePolicy.get'() {
        return resolveInputTypePolicy(Meteor.settings.private);
    },
});
