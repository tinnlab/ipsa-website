import React from 'react';
import './style.css';

const GeneLoading = ({ text = 'Loading...' }) => {
    return (
        <div className="gene-loading-overlay">
            <div className="gene-loading-container">
                {/* DNA Helix animation */}
                <div className="dna-helix-wrapper">
                    <div className="strain"></div>
                    <div className="strain"></div>
                    <div className="strain"></div>
                    <div className="strain"></div>
                    <div className="strain"></div>
                    <div className="strain"></div>
                    <div className="strain"></div>
                    <div className="strain"></div>
                </div>

                <div className="gene-loading-text">{text}</div>
            </div>
        </div>
    );
};

export default GeneLoading;
