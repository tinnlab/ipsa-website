import { promises as fs } from "fs";
import csv from "async-csv";
import { Meteor } from "meteor/meteor";

let fileCache = {};

export default {
    //Save cache for 60 minutes
    read: async (fileName, type = 'csv', cacheTime = 1000 * 10) => {
        if (!fileCache[fileName]) {
            const data = await fs.readFile(fileName, 'utf-8');
            if (type === 'csv') {
                fileCache[fileName] = await csv.parse(data);
            } else if (type === 'raw') {
                fileCache[fileName] = data;
            } else if (type === 'json') {
                fileCache[fileName] = JSON.parse(data);
            } else {
                throw new Meteor.error("File type not supported");
            }

            Meteor.setTimeout(() => {
                delete fileCache[fileName];
            }, cacheTime)
        }
        return fileCache[fileName];
    }
}
