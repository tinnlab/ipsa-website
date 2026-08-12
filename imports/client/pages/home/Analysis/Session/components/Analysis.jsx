import React from "react";
import {Layout} from "antd";
import AnalysisWizard from "./wizard/AnalysisWizard";

const AnalysisLayout = ({inputType, analysisId, sessionId, exampleType, form, sessionInfo}) => {
    // Always use wizard mode
    return (
        <Layout>
            <AnalysisWizard
                analysisId={analysisId}
                sessionId={sessionId}
                form={form}
                sessionInfo={sessionInfo}
                exampleType={exampleType}
            />
        </Layout>
    );
};

export default AnalysisLayout;
