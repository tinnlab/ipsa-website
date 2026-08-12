export default {
    setItem: (key, value) => {
        localStorage.setItem(`${key}:${urlPrefix}`, value);
    },
    getItem: (key) => {
        return localStorage.getItem(`${key}:${urlPrefix}`);
    }
}