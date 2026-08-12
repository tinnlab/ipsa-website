import fetch from "node-fetch";
import fs from "fs";

export default async (url, path) => {
    const res = await fetch(url, {compress: false});
    await new Promise(((resolve, reject) => {
        res.body
            .pipe(fs.createWriteStream(path))
            .on("error", reject)
            .on("finish", () => {
                resolve()
            });
    }))
}