import { Meteor } from "meteor/meteor";
import React, { useMemo, useCallback, useEffect } from 'react';
import { Outlet, Route, Routes } from "react-router";
import { BrowserRouter, Navigate } from 'react-router-dom';
import ConfigProvider from 'antd/lib/config-provider';
import en_US from "antd/lib/locale/en_US";
import { useTracker } from "meteor/react-meteor-data";

import HomeLayout from "./components/layouts/home/HomeLayout";
import Homepage from "./pages/home/Homepage";
import Organism from "./pages/admin/Organism"
import Login from "./pages/admin/Login"
import GeneSet from "./pages/admin/GeneSet"
import GeneInfo from "./pages/admin/GeneInfo"
import IdType from "./pages/admin/IdType"
import Session from './pages/home/Analysis/Session';
import RecentSessions from './pages/home/Analysis/RecentSessions';
import Visualization from "./pages/home/Analysis/Visualization";
import MassAnalysis from "./pages/home/Analysis/MassAnalysis";
import AIInterpretation from "./pages/home/AIInterpretation";
import Contact from "./pages/Contact"
import ImportShare from "./pages/home/Analysis/ImportShare";
import Zoho from "./pages/admin/Zoho";
import Harmonizome from "./pages/admin/Harmonizome";
import CookieConsent from "./components/CookieConsent";

// This component is used to handle tutorial URLs by redirecting to the tutorial server handler
const TutorialRedirect = () => {
  useEffect(() => {
    // Redirect to tutorial index page which will be handled by the server
    window.location.href = `${urlPrefix}/tutorial/`;
  }, []);

  // Return null or a loading message while redirecting
  return <div>Loading tutorial...</div>;
};

export default function App() {
    const user = useTracker(() => Meteor.user(), []);
    const isAdmin = user?.profile.roles.includes("admin");

    const routes = useMemo(() => (
        <Routes>
            {/* Tutorial route - this won't render any React component,
                just redirects to the server-handled route */}
            <Route path={`${urlPrefix}/tutorial`} element={<TutorialRedirect />} />
            <Route path={`${urlPrefix}/tutorial/*`} element={<TutorialRedirect />} />

            {/* Main app routes */}
            <Route element={
                <HomeLayout>
                    <Outlet/>
                </HomeLayout>
            }>
                <Route path={`${urlPrefix}/`} element={<Homepage/>}/>
                <Route path={`${urlPrefix}/analysis/session/:sessionId/:activeAnalysis`}
                       element={<Session/>}/>
                <Route path={`${urlPrefix}/analysis/visualization/:sessionId`}
                       element={<Visualization/>}/>
                <Route path={`${urlPrefix}/analysis/recent-studies`}
                       element={<RecentSessions/>}/>
                <Route path={`${urlPrefix}/analysis/mass-analysis/:sessionId`}
                       element={<MassAnalysis/>}/>
                {/* Share links land here. Deliberately separate from the study/visualization
                    routes: opening this URL grants a COPY, never access to the source study. */}
                <Route path={`${urlPrefix}/import/:shareId`}
                       element={<ImportShare/>}/>
                <Route path={`${urlPrefix}/ai-interpretation`}
                       element={<AIInterpretation/>}/>
                <Route path={`${urlPrefix}/admin/login`} element={<Login/>}/>
                <Route path={`${urlPrefix}/admin/id-type`} element={<IdType/>}/>
                <Route path={`${urlPrefix}/admin/gene-info`} element={<GeneInfo/>}/>
                <Route path={`${urlPrefix}/admin/organism`} element={<Organism/>}/>
                <Route path={`${urlPrefix}/admin/zoho`} element={<Zoho/>}/>
                <Route path={`${urlPrefix}/admin/harmonizome`} element={<Harmonizome/>}/>
                <Route path={`${urlPrefix}/contact`} element={<Contact/>}/>
            </Route>
        </Routes>
    ), []);

    return (
        <BrowserRouter>
            <ConfigProvider locale={en_US}>
                {routes}
                <CookieConsent />
            </ConfigProvider>
        </BrowserRouter>
    );
}