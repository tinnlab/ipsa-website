import React from 'react';
import ReactDOM from 'react-dom/client';

import './main';
import '/imports/client/startup'

import App from '../imports/client/Router';

Meteor.startup(() => {
    const root = ReactDOM.createRoot(document.getElementById("app-root"));
    root.render(
        // <React.StrictMode>
            <App />
        // </React.StrictMode>
    );
})
