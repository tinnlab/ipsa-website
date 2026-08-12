import {Meteor} from 'meteor/meteor';
import {WebApp} from 'meteor/webapp';
import fs from 'fs';
import path from 'path';
import {createReadStream, existsSync} from 'fs';
import { join, extname } from 'path';
import {Transform} from 'stream';

// Is `child` inside `parent` after resolving both? Mirrors the isPathInside guard the retention
// cascade uses. Uses realpathSync where the target exists so a symlink planted under the served
// root cannot point outside it.
const isInside = (parent, child) => {
    let resolvedParent = path.resolve(parent);
    let resolvedChild = path.resolve(child);
    try {
        resolvedParent = fs.realpathSync(resolvedParent);
    } catch (e) { /* parent missing — fall back to the lexical comparison */ }
    try {
        resolvedChild = fs.realpathSync(resolvedChild);
    } catch (e) { /* child missing — 404 handling below will deal with it */ }
    const rel = path.relative(resolvedParent, resolvedChild);
    return rel.length > 0 && !rel.startsWith('..') && !path.isAbsolute(rel);
};

Meteor.startup(() => {
    WebApp.connectHandlers.use('/download', (req, res, next) => {
        const fileName = req.query.file;
        if (!fileName) {
            res.writeHead(400);
            return res.end('File name is required');
        }

        // Use the 'files' subfolder within 'public'
        const downloadRoot = path.join(process.cwd(), 'public', 'files');
        const filePath = path.join(downloadRoot, fileName);

        // path.join collapses '..', so an unchecked `file` escaped the download root entirely:
        //   /download?file=../../../<tempUploadDir>/<userId>/<sessionId>/expression.csv
        // read another user's uploaded expression matrix, and anything else the process could read.
        if (!isInside(downloadRoot, filePath)) {
            res.writeHead(400);
            return res.end('Invalid file name');
        }

        fs.readFile(filePath, (err, data) => {
            if (err) {
                res.writeHead(404);
                return res.end('File not found');
            }

            const contentType = getContentType(fileName);
            res.writeHead(200, {
                'Content-Type': contentType,
                'Content-Disposition': `attachment; filename=${fileName}`
            });
            res.end(data);
        });
    });

    WebApp.connectHandlers.use('/tutorial', (req, res, next) => {
        try {
            // Get the requested path (e.g., /tutorial/index.html → index.html)
            // Default to index.html if the path is just /tutorial/
            const filePath = req.url === '/' ? 'index.html' : req.url.substring(1);

            // Base directory for tutorial files
            const tutorialBaseDir = "/home/meteorer/app/public/tutorial";

            // Full path to the requested file
            const publicPath = join(tutorialBaseDir, filePath);

            // Same confinement as /download above. req.url is attacker-controlled, so without this
            // `curl --path-as-is /tutorial/../../../../etc/passwd` was served straight back.
            if (!isInside(tutorialBaseDir, publicPath)) {
                res.writeHead(400);
                return res.end('Invalid path');
            }

            console.log(`Request for ${req.url} -> Trying to serve: ${publicPath}`);

            // Check if the file exists
            if (existsSync(publicPath)) {
                // Set appropriate Content-Type header based on file extension
                const ext = extname(publicPath).toLowerCase().substring(1);
                const contentTypes = {
                    'html': 'text/html',
                    'css': 'text/css',
                    'js': 'application/javascript',
                    'json': 'application/json',
                    'png': 'image/png',
                    'jpg': 'image/jpeg',
                    'jpeg': 'image/jpeg',
                    'gif': 'image/gif',
                    'svg': 'image/svg+xml',
                    'woff': 'font/woff',
                    'woff2': 'font/woff2',
                    'ttf': 'font/ttf',
                    'eot': 'application/vnd.ms-fontobject',
                    'otf': 'font/otf'
                };

                const contentType = contentTypes[ext] || 'text/plain';
                res.setHeader('Content-Type', contentType);

                // Disable caching for development
                res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
                res.setHeader('Pragma', 'no-cache');
                res.setHeader('Expires', '0');

                // Special handling for index.html to fix redirects
                if (filePath === 'index.html') {
                    // Create a transform stream to modify the HTML content
                    const transformStream = new Transform({
                        transform(chunk, encoding, callback) {
                            let html = chunk.toString();

                            // Replace the meta refresh URL
                            html = html.replace(
                                /<meta http-equiv="refresh" content="0; url=([^"]+)">/i,
                                '<meta http-equiv="refresh" content="0; url=/tutorial/$1">'
                            );

                            // Replace the link URL
                            html = html.replace(
                                /<a href="([^"]+)">Click here if you are not redirected.<\/a>/i,
                                '<a href="/tutorial/$1">Click here if you are not redirected.</a>'
                            );

                            // Replace JavaScript redirect
                            html = html.replace(
                                /location\s*=\s*"([^"]+)"/i,
                                'location = "/tutorial/$1"'
                            );

                            callback(null, html);
                        }
                    });

                    // Stream the file through the transform
                    createReadStream(publicPath)
                        .on('error', (err) => {
                            console.error(`Error streaming file ${publicPath}:`, err);
                            res.writeHead(500);
                            res.end('Internal Server Error');
                        })
                        .pipe(transformStream)
                        .pipe(res);
                } else {
                    // Normal file streaming for non-index files
                    createReadStream(publicPath)
                        .on('error', (err) => {
                            console.error(`Error streaming file ${publicPath}:`, err);
                            res.writeHead(500);
                            res.end('Internal Server Error');
                        })
                        .pipe(res);
                }
            } else {
                console.log(`File not found: ${publicPath}`);
                // If file doesn't exist, send 404
                res.writeHead(404);
                res.end(`File not found: ${filePath}`);
            }
        } catch (error) {
            console.error('Error in tutorial route handler:', error);
            res.writeHead(500);
            res.end('Internal Server Error');
        }
    });
});

function getContentType(fileName) {
    const ext = path.extname(fileName).toLowerCase();
    switch (ext) {
        case '.pdf':
            return 'application/pdf';
        case '.doc':
            return 'application/msword';
        case '.docx':
            return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
        case '.xls':
            return 'application/vnd.ms-excel';
        case '.xlsx':
            return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
        case '.png':
            return 'image/png';
        case '.jpg':
        case '.jpeg':
            return 'image/jpeg';
        case '.gif':
            return 'image/gif';
        default:
            return 'application/octet-stream';
    }
}