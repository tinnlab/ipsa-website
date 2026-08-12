
import React from 'react';
import CircosD3 from '../../../../../components/circos-d3';

const CircosD3Chart = ({pathwayGenes, flows, chartId}) => {
    // if (pathwayGenes.length === 0 || flows.length === 0) {
    //     return "loading"
    // }
    return (
        <div className="flex items-center justify-center h-full w-full">
            <CircosD3 pathwayGenes={pathwayGenes} flows={flows} chartId={chartId} />
        </div>
    );
}

export default CircosD3Chart;