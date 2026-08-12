import React from 'react';
import {Modal} from 'antd';
import _ from 'lodash';
import PropTypes from 'prop-types';

import FileManager from '/imports/client/components/file-manager/react/FileManager'
import FileNavigator from '/imports/client/components/file-manager/react/FileNavigator';
import connectorNodeV1 from '/imports/client/components/file-manager/connector-node-v1';
import "./index.less"

export default class SelectFileModal extends React.Component {
    static propTypes = {
        onSelectFile: PropTypes.func.isRequired
    };

    constructor(props) {
        super(props);
    }

    static getFullPath = (node) => {
        let parentIndex = _.findIndex(node.ancestors, {id: node.parentId});
        if (parentIndex) {
            return [...SelectFileModal.getFullPath(node.ancestors[parentIndex]), node.name];
        } else return [node.name];
    }

    onSelectFile = (rowData) => {
        if (rowData.type === 'file') {
            let fileName = SelectFileModal.getFullPath(rowData);
            this.props.onSelectFile && this.props.onSelectFile(fileName);
        }
    };

    render() {

        const apiOptions = {
            apiRoot: urlPrefix + `/file-manager-api`
        };
        return (
            <Modal footer={null} {...this.props}
                   className="select-file-modal"
                   closable={false}
            >
                <FileManager className="file-manager">
                    <FileNavigator {...connectorNodeV1}
                                   apiOptions={apiOptions}
                                   onResourceItemDoubleClick={({rowData}) => this.onSelectFile(rowData)}
                                   capabilities={this.props.capabilities || (() => [])}
                    />
                </FileManager>
            </Modal>
        )
    }
}
