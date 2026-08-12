import message from 'antd/lib/message';
import "./collections"

window.urlPrefix = Meteor.settings.public.urlPrefix;

// Use antd's `message` (compact top-center toast) instead of `notification`.
// `notification` rendered an empty title row holding only the close button and
// relied on stale antd-v4 CSS that showed a white background; `message` has none
// of that. Redefining the global here fixes every notify.* call site at once.
window.notify = ['success', 'error', 'info', 'warning'].reduce((obj, level) => {
    obj[level] = (description) => message[level](description);
    return obj
}, {});

// Meteor.asyncCall = async (method, params) => new Promise((resolve, reject) => Meteor.call(method, params, (err, data) => err ? reject(err) : resolve(data)));

Meteor.asyncCallWithNotification = async (method, params) => {
    try {
        return await Meteor.callAsync(method, params)
    } catch (e) {
        notify.error(e.reason);
        throw e;
    }
};

Meteor.startup(async () => {
    if (!Meteor.userId()) {
        let {username, password} = await Meteor.asyncCallWithNotification("user.createGuestAccount")
        Meteor.loginWithPassword(username, password, (error) => {
        });
    }

    let _open = window.XMLHttpRequest.prototype.open;
    window.XMLHttpRequest.prototype.open = function () {
        let _ = _open.apply(this, [].slice.call(arguments));
        this.setRequestHeader('user-token', Accounts._storedLoginToken());
        return _;
    };

    Meteor.loginByWorkspace = function(ws_data, callback) {
        //create a login request with admin: true, so our loginHandler can handle this request
        var loginRequest = {workspace: true, username: ws_data.ws_name, passcode: ws_data.ws_password};
        //send the login request
        Accounts.callLoginMethod({
            methodArguments: [loginRequest],
            userCallback: callback
        });
    };
})
