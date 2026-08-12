import {Meteor} from "meteor/meteor"
import fs from "fs"
import {Random} from "meteor/random"
import path from "path"
import getUserDataPath from "../../helper/getUserDataPath";
import rCommand from "/server/include/rCommand"
import getGEOData from "/imports/utils/getGEOData"
import _ from "lodash"

Meteor.methods({
    async 'geo.import'({id, groups, path: savePath}) {
        let virtualPath = path.join(savePath, id);
        savePath = savePath.replace(/^Root\//, '')
        savePath = getUserDataPath(path.join(savePath, id))

        if (fs.existsSync(savePath)) {
            let rand = Random.id().slice(0, 4)
            savePath += '-' + rand
            virtualPath += '-' + rand
        }
        savePath += '/'

        try {
            fs.mkdirSync(savePath)
        } catch (e) {
            return {
                error: true,
                message: "Cannot create directory. The example folder is read-only. Please select another folder."
            }
        }

        try {
            let samples = []

            if (!groups || !groups.length) {
                let data = await getGEOData(id)
                samples = data.samples
            } else {
                samples = _.uniq(
                    groups.map(e => e.samples).flat()
                )
            }

            if (samples.length > Meteor.settings.public.GEOLimit) {
                return {
                    error: true,
                    message: `Maximum ${Meteor.settings.public.GEOLimit} samples can be imported. Please specify samples to be imported in each group below.`
                }
            }

            let importedSamples = await rCommand.getGEOData({id, samples, savePath})

            if (groups && groups.length) {
                let groupFile = path.join(savePath, 'group.csv')
                groups = groups.map(e => e[0] + ',' + `"${e[1]}"`).join('\n')
                fs.writeFileSync(groupFile, groups)
            }

            let notFoundSamples = samples.filter(e => importedSamples.indexOf(e) === -1)
            let commonMessage = `Data successfully imported to ${virtualPath}.`
            return {
                error: false,
                message: notFoundSamples.length ? `${commonMessage}\nWarning: These samples are not found: " + notFoundSamples.join(', ')` : commonMessage
            }
        } catch (e) {
            return {
                error: true,
                message: "Error when importing data. Data must be manually processed and uploaded to the server. Error message: " + e.message.replace(/Error in[^:]+:/, '')
            }
        }
    }
})

