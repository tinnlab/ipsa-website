import {useEffect, useState} from "react";
import {Meteor} from "meteor/meteor";
import {useTracker} from "meteor/react-meteor-data";
import {isStudyAccessError} from "/imports/utils/ownership";

// Does the current account have access to this study?
//
// Studies are owner-locked server-side, and the publications answer a non-owner with this.ready()
// and no documents (server/helper/ownership.js) — so the minimongo-driven study pages cannot tell
// "denied" from "still loading" and spin forever. The only reliable signal is a guarded METHOD
// rejecting, so we ask one deliberately.
//
// session.getName is that probe: assertOwnsSession plus one string. It is cheap, it asks precisely
// the question the page needs answered, and it had no other client caller so adopting it cannot
// regress anything. Reading each page's existing failing call does NOT work as an alternative:
// MassAnalysis issues no method call at all before its spinner, and the first failure on
// Visualization is a REST 403 carrying no Meteor error code to classify.
//
// Returns {accessChecked, accessDenied, studyName}. accessDenied stays false until accessChecked is
// true, so `if (accessDenied) return <StudyAccessDenied/>` is safe on its own.
export default function useStudyAccess(sessionId) {
    // Every visitor is auto-logged-in as a guest, asynchronously, at startup (imports/client/
    // startup.js), so Meteor.userId() is null on a cold first paint. Probing in that window would
    // reject with not-authorized and show a first-time visitor a denial for a study that is about to
    // be theirs. Waiting for a settled login also covers the resume-token window on a hard refresh,
    // where a real owner's userId is briefly null. Same guard the /import/:shareId page uses.
    const {userId, loggingIn} = useTracker(() => ({
        userId: Meteor.userId(),
        loggingIn: Meteor.loggingIn(),
    }), []);

    const [state, setState] = useState({accessChecked: false, accessDenied: false, studyName: ""});

    useEffect(() => {
        if (!sessionId || !userId || loggingIn) {
            // Not a verdict — the identity is not settled yet. Reset so a verdict reached for the
            // previous account can never linger across a re-login.
            setState({accessChecked: false, accessDenied: false, studyName: ""});
            return undefined;
        }
        let cancelled = false;
        (async () => {
            try {
                // Positional argument: the method signature is 'session.getName'(sessionId).
                const name = await Meteor.callAsync("session.getName", sessionId);
                if (!cancelled) {
                    setState({accessChecked: true, accessDenied: false, studyName: name || ""});
                }
            } catch (error) {
                // ONLY the two ownership codes mean denied. Anything else (a disconnect, a server
                // bug) leaves the page on its normal loading path rather than evicting an owner.
                if (!cancelled) {
                    setState({
                        accessChecked: true,
                        accessDenied: isStudyAccessError(error),
                        studyName: "",
                    });
                }
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [sessionId, userId, loggingIn]);

    return state;
}
