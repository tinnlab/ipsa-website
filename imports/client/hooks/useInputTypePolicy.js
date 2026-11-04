import useMethod from './useMethod';
import {resolveInputTypePolicy} from '/imports/utils/inputTypePolicy';

// The server's input-type policy (imports/utils/inputTypePolicy.js). Until the method answers —
// or if it fails — this returns the shipped defaults, so a gate is never silently open while
// loading. The server enforces the same policy regardless.
export default function useInputTypePolicy() {
    const {data} = useMethod('inputTypePolicy.get', undefined, []);
    return resolveInputTypePolicy(data || {});
}
