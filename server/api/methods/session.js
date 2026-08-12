import { Meteor } from 'meteor/meteor';
import { Random } from 'meteor/random';
import { check } from 'meteor/check';
import { createHash } from 'crypto';
import { assertWritableSession } from '../../helper/ownership';

// Simple rate limiter using in-memory storage
const rateLimitStore = new Map();

function checkRateLimit(key, maxAttempts, windowMs) {
    const now = Date.now();
    const record = rateLimitStore.get(key) || { count: 0, resetTime: now + windowMs };

    if (now > record.resetTime) {
        // Reset window
        record.count = 1;
        record.resetTime = now + windowMs;
        rateLimitStore.set(key, record);
        return true;
    }

    if (record.count >= maxAttempts) {
        return false;
    }

    record.count++;
    rateLimitStore.set(key, record);
    return true;
}

function hashPassword(password) {
    return createHash('sha256').update(password).digest('hex');
}

Meteor.methods({
    /**
     * Save workspace - save all current sessions with workspace name, email, and password
     */
    async 'workspace.save'({ workspaceName, email, password }) {
        if (!this.userId) {
            throw new Meteor.Error('not-authorized', 'You must be logged in to save workspace');
        }

        // Validate inputs
        if (!workspaceName || workspaceName.trim().length === 0) {
            throw new Meteor.Error('invalid-input', 'Workspace name is required');
        }

        if (!email || email.trim().length === 0) {
            throw new Meteor.Error('invalid-input', 'Email is required');
        }

        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            throw new Meteor.Error('invalid-email', 'Please enter a valid email address');
        }

        if (!password || password.trim().length < 6) {
            throw new Meteor.Error('invalid-input', 'Password must be at least 6 characters');
        }

        // Find all active sessions for current user
        const sessions = await DBCollections.Session.find({
            userId: this.userId,
            status: 'Active'
        }).fetchAsync();

        if (sessions.length === 0) {
            throw new Meteor.Error('no-sessions', 'No active sessions to save');
        }

        // Hash password
        const passwordHash = hashPassword(password);
        const emailLower = email.toLowerCase().trim();

        // Update all sessions with workspace info
        for (const session of sessions) {
            await DBCollections.Session.updateAsync(session._id, {
                $set: {
                    workspaceName: workspaceName.trim(),
                    workspaceEmail: emailLower,
                    workspacePassword: passwordHash,
                    hasWorkspace: true,
                    workspaceSavedAt: new Date()
                }
            });
        }

        console.log(`Workspace "${workspaceName}" saved with ${sessions.length} sessions for email ${emailLower}`);

        return {
            success: true,
            sessionCount: sessions.length,
            message: `Workspace saved successfully with ${sessions.length} session(s)!`
        };
    },

    /**
     * List workspaces - get all workspaces for email and password
     */
    async 'workspace.list'({ email, password }) {
        if (!this.userId) {
            throw new Meteor.Error('not-authorized', 'You must be logged in to list workspaces');
        }

        // Rate limiting: 10 attempts per hour per user
        const rateLimitKey = `workspace-list:${this.userId}`;
        if (!checkRateLimit(rateLimitKey, 10, 3600000)) {
            throw new Meteor.Error('rate-limit', 'Too many attempts. Please try again in 1 hour.');
        }

        // Validate inputs
        if (!email || email.trim().length === 0) {
            throw new Meteor.Error('invalid-input', 'Email is required');
        }

        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            throw new Meteor.Error('invalid-email', 'Please enter a valid email address');
        }

        if (!password || password.trim().length === 0) {
            throw new Meteor.Error('invalid-input', 'Password is required');
        }

        const emailLower = email.toLowerCase().trim();
        const passwordHash = hashPassword(password);

        // Find all sessions with this email and password
        const sessions = await DBCollections.Session.find({
            workspaceEmail: emailLower,
            workspacePassword: passwordHash,
            userId: { $ne: this.userId },
            status: 'Active',
            hasWorkspace: true
        }).fetchAsync();

        // Group sessions by workspace name
        const workspaceMap = new Map();
        for (const session of sessions) {
            const wsName = session.workspaceName;
            if (!workspaceMap.has(wsName)) {
                workspaceMap.set(wsName, {
                    name: wsName,
                    sessionCount: 0,
                    savedAt: session.workspaceSavedAt
                });
            }
            const ws = workspaceMap.get(wsName);
            ws.sessionCount++;
            // Keep the latest savedAt date
            if (session.workspaceSavedAt > ws.savedAt) {
                ws.savedAt = session.workspaceSavedAt;
            }
        }

        const workspaces = Array.from(workspaceMap.values());

        console.log(`Found ${workspaces.length} workspaces for email ${emailLower}`);

        return {
            success: true,
            workspaces: workspaces
        };
    },

    /**
     * Recover workspace - recover all sessions from a workspace using email, name, and password
     */
    async 'workspace.recover'({ workspaceName, email, password }) {
        if (!this.userId) {
            throw new Meteor.Error('not-authorized', 'You must be logged in to recover workspace');
        }

        // Rate limiting: 5 attempts per hour per user
        const rateLimitKey = `workspace-recovery:${this.userId}`;
        if (!checkRateLimit(rateLimitKey, 5, 3600000)) {
            throw new Meteor.Error('rate-limit', 'Too many recovery attempts. Please try again in 1 hour.');
        }

        // Validate inputs
        if (!workspaceName || workspaceName.trim().length === 0) {
            throw new Meteor.Error('invalid-input', 'Workspace name is required');
        }

        if (!email || email.trim().length === 0) {
            throw new Meteor.Error('invalid-input', 'Email is required');
        }

        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            throw new Meteor.Error('invalid-email', 'Please enter a valid email address');
        }

        if (!password || password.trim().length === 0) {
            throw new Meteor.Error('invalid-input', 'Password is required');
        }

        const emailLower = email.toLowerCase().trim();
        const passwordHash = hashPassword(password);

        // Find sessions by workspace name, email, and password (not owned by current user)
        const sessions = await DBCollections.Session.find({
            workspaceName: workspaceName.trim(),
            workspaceEmail: emailLower,
            workspacePassword: passwordHash,
            userId: { $ne: this.userId },
            status: 'Active',
            hasWorkspace: true
        }).fetchAsync();

        if (sessions.length === 0) {
            // Log failed attempt
            await DBCollections.SessionRecoveryLog.insertAsync({
                attemptBy: this.userId,
                attemptType: 'workspace',
                success: false,
                workspaceName: workspaceName,
                email: emailLower,
                timestamp: new Date(),
                errorReason: 'Workspace not found or already owned'
            });

            throw new Meteor.Error('not-found', 'No workspace found with those credentials, or you already own it.');
        }

        // Transfer ownership of all sessions
        const oldUserId = sessions[0].userId;
        for (const session of sessions) {
            await DBCollections.Session.updateAsync(session._id, {
                $set: { userId: this.userId },
                $push: {
                    transferHistory: {
                        fromUserId: oldUserId,
                        toUserId: this.userId,
                        method: 'workspace-recovery',
                        workspaceName: workspaceName,
                        email: emailLower,
                        timestamp: new Date()
                    }
                }
            });
        }

        // Log successful recovery
        await DBCollections.SessionRecoveryLog.insertAsync({
            sessionIds: sessions.map(s => s._id),
            attemptBy: this.userId,
            attemptType: 'workspace',
            success: true,
            oldUserId: oldUserId,
            workspaceName: workspaceName,
            email: emailLower,
            timestamp: new Date()
        });

        console.log(`Workspace "${workspaceName}" recovered: ${sessions.length} sessions transferred to user ${this.userId}`);

        return {
            success: true,
            recoveredCount: sessions.length,
            workspaceName: workspaceName,
            message: `Successfully recovered ${sessions.length} session(s) from workspace "${workspaceName}"!`
        };
    },

    /**
     * OLD: Recover session using recovery password (DEPRECATED - use workspace.recover instead)
     */
    /*
    async 'session.recoverWithPassword'({ sessionName, recoveryPassword }) {
        if (!this.userId) {
            throw new Meteor.Error('not-authorized', 'You must be logged in to recover sessions');
        }

        // Rate limiting: 5 attempts per hour per user
        const rateLimitKey = `password-recovery:${this.userId}`;
        if (!checkRateLimit(rateLimitKey, 5, 3600000)) {
            throw new Meteor.Error('rate-limit', 'Too many recovery attempts. Please try again in 1 hour.');
        }

        // Validate inputs
        if (!sessionName || sessionName.trim().length === 0) {
            throw new Meteor.Error('invalid-input', 'Session name is required');
        }

        if (!recoveryPassword || recoveryPassword.trim().length === 0) {
            throw new Meteor.Error('invalid-input', 'Recovery password is required');
        }

        // Find session by name (not owned by current user, has recovery password)
        const sessions = await DBCollections.Session.find({
            name: sessionName.trim(),
            userId: { $ne: this.userId },
            status: 'Active',
            hasRecoveryPassword: true
        }).fetchAsync();

        if (sessions.length === 0) {
            // Log failed attempt
            await DBCollections.SessionRecoveryLog.insertAsync({
                attemptBy: this.userId,
                attemptType: 'password',
                success: false,
                sessionName: sessionName,
                timestamp: new Date(),
                errorReason: 'Session not found'
            });

            throw new Meteor.Error('not-found', 'No password-protected session found with that name, or you already own it.');
        }

        if (sessions.length > 1) {
            throw new Meteor.Error('multiple-found', 'Multiple sessions found with that name. Please contact support.');
        }

        const session = sessions[0];

        // Verify password
        const passwordHash = hashPassword(recoveryPassword);
        const passwordMatch = session.recoveryPassword === passwordHash;

        if (!passwordMatch) {
            // Log failed attempt
            await DBCollections.SessionRecoveryLog.insertAsync({
                sessionId: session._id,
                attemptBy: this.userId,
                attemptType: 'password',
                success: false,
                timestamp: new Date(),
                errorReason: 'Invalid password'
            });

            throw new Meteor.Error('invalid-password', 'Invalid recovery password');
        }

        // Transfer ownership
        const oldUserId = session.userId;
        await DBCollections.Session.updateAsync(session._id, {
            $set: { userId: this.userId },
            $push: {
                transferHistory: {
                    fromUserId: oldUserId,
                    toUserId: this.userId,
                    method: 'password-recovery',
                    timestamp: new Date()
                }
            }
        });

        // Log successful recovery
        await DBCollections.SessionRecoveryLog.insertAsync({
            sessionId: session._id,
            attemptBy: this.userId,
            attemptType: 'password',
            success: true,
            oldUserId,
            timestamp: new Date()
        });

        return {
            success: true,
            sessionId: session._id,
            sessionName: session.name,
            message: 'Session recovered successfully!'
        };
    },

    /**
     * Request email recovery - sends recovery link to email
     * DISABLED: Requires Zoho email configuration
     */
    /*
    async 'session.requestEmailRecovery'({ email }) {
        if (!this.userId) {
            throw new Meteor.Error('not-authorized', 'You must be logged in to request recovery');
        }

        // Rate limiting: 3 attempts per hour per IP
        const rateLimitKey = `email-recovery:${this.connection.clientAddress}`;
        if (!checkRateLimit(rateLimitKey, 3, 3600000)) {
            throw new Meteor.Error('rate-limit', 'Too many requests. Please try again later.');
        }

        // Validate email
        if (!email || email.trim().length === 0) {
            throw new Meteor.Error('invalid-input', 'Email address is required');
        }

        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            throw new Meteor.Error('invalid-email', 'Please enter a valid email address');
        }

        // Find user by email
        const user = await Meteor.users.findOneAsync({
            'emails.0.address': email.toLowerCase().trim()
        });

        if (!user) {
            // Don't reveal if email exists (security best practice)
            return {
                success: true,
                message: 'If that email has sessions, a recovery link has been sent.'
            };
        }

        // Don't allow recovering your own sessions
        if (user._id === this.userId) {
            return {
                success: true,
                message: 'If that email has sessions, a recovery link has been sent.'
            };
        }

        // Find active sessions owned by this user
        const sessions = await DBCollections.Session.find({
            userId: user._id,
            status: 'Active'
        }).fetchAsync();

        if (sessions.length === 0) {
            return {
                success: true,
                message: 'If that email has sessions, a recovery link has been sent.'
            };
        }

        // Generate secure recovery token
        const token = Random.secret(32);
        const expiresAt = new Date(Date.now() + 3600000); // 1 hour

        // Store recovery token
        await DBCollections.EmailRecoveryToken.insertAsync({
            token,
            email: email.toLowerCase().trim(),
            requestingUserId: this.userId,
            targetUserId: user._id,
            sessionIds: sessions.map(s => s._id),
            createdAt: new Date(),
            expiresAt,
            used: false
        });

        // Build recovery URL
        const recoveryUrl = `${Meteor.absoluteUrl()}${urlPrefix}/recover-sessions?token=${token}`;

        // Build email content
        const sessionList = sessions.map(s =>
            `<li><strong>${s.name}</strong> (created ${s.createdAt.toLocaleDateString()})</li>`
        ).join('');

        const emailContent = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Session Recovery Request</title>
</head>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
    <header style="background-color: #f4f4f4; padding: 20px; text-align: center;">
        <h1 style="color: #0066cc; margin: 0;">IPSA Platform</h1>
    </header>
    <main style="padding: 20px;">
        <h2>Session Recovery Request</h2>
        <p>Someone requested to recover your analysis sessions on the IPSA platform.</p>

        <div style="background-color: #e6f3ff; border-left: 5px solid #0066cc; padding: 15px; margin: 20px 0;">
            <p><strong>${sessions.length} session(s) found:</strong></p>
            <ul style="margin: 10px 0; padding-left: 20px;">
                ${sessionList}
            </ul>
        </div>

        <p>Click the button below to recover these sessions:</p>

        <div style="text-align: center; margin: 30px 0;">
            <a href="${recoveryUrl}" style="background-color: #0066cc; color: white; padding: 15px 30px; text-decoration: none; border-radius: 5px; display: inline-block; font-weight: bold;">
                Recover My Sessions
            </a>
        </div>

        <p style="color: #666; font-size: 12px; margin-top: 30px; padding-top: 20px; border-top: 1px solid #ddd;">
            <strong>Important:</strong> This link will expire in 1 hour. If you didn't request this recovery, please ignore this email and your sessions will remain secure.
        </p>
    </main>
    <footer style="background-color: #f4f4f4; padding: 20px; text-align: center;">
        <p style="margin: 0; color: #666; font-size: 12px;">
            IPSA Platform - Tin Nguyen's Lab at Wayne State University
        </p>
    </footer>
</body>
</html>`;

        // Send email using existing Zoho email method
        try {
            await Meteor.callAsync('sendZohoEmail', {
                fromAddress: process.env.ZOHO_FROM_ADDRESS || "no-reply@example.com",
                toAddress: email.toLowerCase().trim(),
                subject: "Recover Your IPSA Analysis Sessions",
                content: emailContent,
                askReceipt: "no"
            });

            console.log(`Recovery email sent to ${email} for ${sessions.length} sessions`);
        } catch (error) {
            console.error('Error sending recovery email:', error);
            throw new Meteor.Error('email-failed', 'Failed to send recovery email. Please try again later.');
        }

        return {
            success: true,
            message: 'If that email has sessions, a recovery link has been sent.'
        };
    },
    */

    /**
     * Complete email recovery - transfers sessions using token from email link
     * DISABLED: Requires Zoho email configuration
     */
    /*
    async 'session.completeEmailRecovery'({ token }) {
        if (!this.userId) {
            throw new Meteor.Error('not-authorized', 'You must be logged in to complete recovery');
        }

        if (!token || token.trim().length === 0) {
            throw new Meteor.Error('invalid-token', 'Recovery token is required');
        }

        // Find recovery token
        const recoveryToken = await DBCollections.EmailRecoveryToken.findOneAsync({
            token: token.trim(),
            used: false,
            expiresAt: { $gt: new Date() }
        });

        if (!recoveryToken) {
            throw new Meteor.Error('invalid-token', 'Recovery link is invalid or has expired. Please request a new recovery link.');
        }

        // Transfer all sessions to current user
        const sessionIds = recoveryToken.sessionIds;
        const oldUserId = recoveryToken.targetUserId;

        for (const sessionId of sessionIds) {
            await DBCollections.Session.updateAsync(
                { _id: sessionId },
                {
                    $set: { userId: this.userId },
                    $push: {
                        transferHistory: {
                            fromUserId: oldUserId,
                            toUserId: this.userId,
                            method: 'email-recovery',
                            timestamp: new Date(),
                            email: recoveryToken.email
                        }
                    }
                }
            );
        }

        // Mark token as used
        await DBCollections.EmailRecoveryToken.updateAsync(recoveryToken._id, {
            $set: {
                used: true,
                usedAt: new Date(),
                usedBy: this.userId
            }
        });

        // Log successful recovery
        await DBCollections.SessionRecoveryLog.insertAsync({
            sessionIds: sessionIds,
            attemptBy: this.userId,
            attemptType: 'email',
            success: true,
            oldUserId: oldUserId,
            email: recoveryToken.email,
            timestamp: new Date()
        });

        console.log(`Email recovery completed: ${sessionIds.length} sessions transferred to user ${this.userId}`);

        return {
            success: true,
            recoveredCount: sessionIds.length,
            sessionIds: sessionIds,
            message: `Successfully recovered ${sessionIds.length} session(s)!`
        };
    }
    */

    /**
     * Update metadata for analyses in a session
     */
    async 'session.updateAnalysisMetadata'({ sessionId, metadataUpdates }) {
        if (!this.userId) {
            throw new Meteor.Error('not-authorized', 'You must be logged in to update metadata');
        }

        if (!sessionId) {
            throw new Meteor.Error('invalid-input', 'Session ID is required');
        }

        if (!metadataUpdates || typeof metadataUpdates !== 'object') {
            throw new Meteor.Error('invalid-input', 'Metadata updates must be an object');
        }

        console.log(`Updating metadata for session ${sessionId}:`, Object.keys(metadataUpdates));

        // Ownership AND writability: a view-only imported study must reject metadata edits even
        // though the recipient owns it. check() the id too — it reaches a selector.
        check(sessionId, String);
        const session = await assertWritableSession({ sessionId, requesterUserId: this.userId });

        // Update each analysis metadata
        const updatedAnalyses = session.analyses.map(analysis => {
            if (metadataUpdates[analysis.name]) {
                return {
                    ...analysis,
                    metadata: {
                        ...analysis.metadata,
                        extracted: metadataUpdates[analysis.name]
                    }
                };
            }
            return analysis;
        });

        // Update the session
        await DBCollections.Session.updateAsync(
            { _id: sessionId },
            {
                $set: {
                    analyses: updatedAnalyses,
                    lastModified: new Date()
                }
            }
        );

        console.log(`✅ Metadata updated for ${Object.keys(metadataUpdates).length} analyses in session ${sessionId}`);

        return {
            success: true,
            updatedCount: Object.keys(metadataUpdates).length
        };
    }
});
