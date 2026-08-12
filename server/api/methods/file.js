import {Meteor} from 'meteor/meteor';
import {WebApp} from 'meteor/webapp';
import {check, Match} from 'meteor/check';
import path from "path";
import fs from "fs";
import multer from "multer";
import sanitize from "sanitize-filename";
import {resolveRequestUserId} from "/server/helper/resolveRequestUser";
import {assertOwnsSession, findOwnedSession} from "/server/helper/ownership";

const uploadDir = Meteor.settings.private.tempUploadDir;

// Every upload path here used to take userId, sessionId and fileName straight from the caller and
// interpolate them into a filesystem path, with no authentication, no ownership check and no
// traversal guard. That is an unauthenticated arbitrary file write: a caller could drop a file into
// any user's study directory — overwriting their expression matrix and silently changing their
// results — or walk out of the upload tree entirely with '..' segments.
//
// resolveUploadDir is the single place that builds a destination. It derives the owning user from
// the SERVER's view of the session rather than from the request, sanitizes the filename, and
// refuses anything that does not resolve inside the upload root.

const isInsideUploadRoot = (candidate) => {
    const root = path.resolve(uploadDir);
    const rel = path.relative(root, path.resolve(candidate));
    return rel.length > 0 && !rel.startsWith('..') && !path.isAbsolute(rel);
};

// Build <uploadRoot>/<ownerUserId>/<sessionId>[/<extra>] for a session the caller owns.
// ownerUserId comes from the session document, never from the caller.
const resolveUploadDir = (session, ...extra) => {
    const dir = path.join(uploadDir, String(session.userId), String(session._id), ...extra);
    if (!isInsideUploadRoot(dir)) {
        throw new Meteor.Error('invalid-path', 'Invalid upload path.');
    }
    return dir;
};

// Filenames are attacker-controlled. sanitize-filename strips separators and traversal, and the
// result is re-checked against the root after joining.
const resolveUploadFile = (session, fileName, ...extra) => {
    const safeName = sanitize(String(fileName || ''));
    if (!safeName) {
        throw new Meteor.Error('invalid-filename', 'Invalid file name.');
    }
    const full = path.join(resolveUploadDir(session, ...extra), safeName);
    if (!isInsideUploadRoot(full)) {
        throw new Meteor.Error('invalid-path', 'Invalid upload path.');
    }
    return full;
};

const ensureDir = (dir) => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, {recursive: true});
    }
    return dir;
};

// multer resolves the destination before our handler runs, so authentication has to happen in the
// storage callbacks. The resolved session is stashed on the request for the handler below.
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        (async () => {
            const userId = await resolveRequestUserId(req);
            if (!userId) throw new Error('Authentication required');
            const session = await findOwnedSession({sessionId: req.query.sessionId, requesterUserId: userId});
            if (!session) throw new Error('Not authorized for this study');
            // req.query.userId is deliberately ignored — the directory is the session owner's.
            return ensureDir(resolveUploadDir(session));
        })().then((dir) => cb(null, dir), (err) => cb(err));
    },
    filename: function (req, file, cb) {
        try {
            const safeName = sanitize(String(req.query.fileName || ''));
            if (!safeName) throw new Error('Invalid file name');
            // Stashed so the success handler can tell the client which name was actually written:
            // the client records this into AnalysisConfig.expressionFile/groupFile, and if it
            // recorded the raw name instead, a name needing sanitising would be stored under one
            // name and looked up under another — "input file missing" at run time.
            req._storedFileName = safeName;
            cb(null, safeName);
        } catch (err) {
            cb(err);
        }
    }
})

const upload = multer({storage: storage});

WebApp.connectHandlers.use('/api/upload', upload.single('file'), (err, req, res, next) => {
    // Connect's error-handling signature (4 args): multer surfaces the auth/validation failures
    // raised in the storage callbacks here.
    const message = err && err.message ? err.message : 'Upload failed';
    const status = message === 'Authentication required' ? 401
        : message === 'Not authorized for this study' ? 403
        : 400;
    res.writeHead(status, {'Content-Type': 'application/json', 'Cache-Control': 'no-store'});
    res.end(JSON.stringify({error: message}));
});

WebApp.connectHandlers.use('/api/upload', (req, res) => {
    // A request carrying no multipart file part never reaches the storage callbacks, so it would
    // otherwise skip authentication entirely and still be answered 200. Nothing is written either
    // way, but the response should not imply success.
    if (!req.file || !req._storedFileName) {
        res.writeHead(400, {'Content-Type': 'application/json', 'Cache-Control': 'no-store'});
        res.end(JSON.stringify({error: 'No file uploaded'}));
        return;
    }
    // Return the name actually written, so the caller records that rather than the raw one.
    res.writeHead(200, {'Content-Type': 'application/json', 'Cache-Control': 'no-store'});
    res.end(JSON.stringify({
        success: true,
        fileName: req._storedFileName,
    }));
})

Meteor.methods({
    async 'file.upload'(data) {
        this.unblock();
        check(data, Match.ObjectIncluding({sessionId: String, filename: String}));
        // data.userId is ignored: the destination belongs to whoever owns the session.
        const session = await assertOwnsSession({sessionId: data.sessionId, requesterUserId: this.userId});
        console.log("file.upload", data.filename);
        ensureDir(resolveUploadDir(session));
        const fullPath = resolveUploadFile(session, data.filename);
        await new Promise((resolve, reject) => {
            fs.writeFile(fullPath, Buffer.from(data.fileContent), (err) => {
                if (err) {
                    reject(err);
                } else {
                    resolve();
                }
            });
        });
    },
    async 'file.uploadFileChunk'({fileId, chunk, chunkIndex, totalChunks, fileName, userId, sessionId}) {
        this.unblock();
        check(sessionId, String);
        check(fileId, String);
        const session = await assertOwnsSession({sessionId, requesterUserId: this.userId});
        // fileId becomes a directory name, so it is sanitized like any other caller-supplied segment.
        const chunkDir = ensureDir(resolveUploadDir(session, sanitize(fileId)));
        const chunkPath = resolveUploadFile(session, `chunk_${parseInt(chunkIndex, 10)}`, sanitize(fileId));
        await new Promise(async (resolve, reject) => {
            await fs.writeFileSync(chunkPath, chunk);
            resolve();
        })
    },
    async 'file.finalizeFileUpload'({fileId, fileName, userId, sessionId}) {
        this.unblock();
        check(sessionId, String);
        check(fileId, String);
        check(fileName, String);
        const session = await assertOwnsSession({sessionId, requesterUserId: this.userId});
        const chunkDir = resolveUploadDir(session, sanitize(fileId));
        const finalFilePath = resolveUploadFile(session, fileName);

        const chunks = fs.readdirSync(chunkDir)
            .filter(file => file.startsWith('chunk_'))
            .sort((a, b) => {
                const aIndex = parseInt(a.split('_')[1]);
                const bIndex = parseInt(b.split('_')[1]);
                return aIndex - bIndex;
            })

        let combinedBase64 = '';
        console.log("chunks", chunks.length);
        for (const chunk of chunks) {
            const chunkPath = path.join(chunkDir, chunk);
            const chunkData = fs.readFileSync(chunkPath,'utf8');
            combinedBase64 += chunkData;
            fs.unlinkSync(chunkPath);
        }
        const buffer = Buffer.from(combinedBase64, 'base64');
        fs.writeFileSync(finalFilePath, buffer);

        fs.rmdirSync(chunkDir);
        return {success: true, path: finalFilePath};
    }
});
