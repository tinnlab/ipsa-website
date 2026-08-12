import React from 'react';
import useMethod from '../../../../hooks/useMethod';
import Layout from 'antd/lib/layout';
import ResultsTable from './components/ResultsTable';

import './index.style.less'
import {useLocation, useParams} from "react-router-dom";

export default (props) => {
    const sessionId = useParams().sessionId;
    // get all data from snapshot and results collections
    const { isLoading, data } = useMethod('get.session.visualization.data', { sessionId }, [sessionId]);

    if (isLoading) {
        return <div>Loading...</div>
    }

    return (
        <Layout className={'visualize-page-wrapper'}>
            <ResultsTable data={data} />
        </Layout>
    )
}