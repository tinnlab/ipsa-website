import * as echarts from 'echarts/lib/echarts'
import graphicGL from 'echarts-gl/lib/util/graphicGL'
import PointsMesh from './SquareMesh'
import LabelsBuilder from 'echarts-gl/lib/component/common/LabelsBuilder'
import {
  getItemVisualColor,
  getItemVisualOpacity,
} from 'echarts-gl/lib/util/visual'
import _ from 'lodash'

var Z_2D = -10

function isSymbolSizeSame(a, b) {
  return a && b && a[0] === b[0] && a[1] === b[1]
}

// TODO gl_PointSize has max value.
function SquareBuilder(api) {
  this.rootNode = new graphicGL.Node()

  this._labelsBuilder = new LabelsBuilder(256, 256, api)
  // Give a large render order.
  this._labelsBuilder.getMesh().renderOrder = 100
  this.rootNode.add(this._labelsBuilder.getMesh())

  this._startDataIndex = 0
  this._endDataIndex = 0

  this._api = api
}

SquareBuilder.prototype = {
  constructor: SquareBuilder,

  /**
   * If highlight on over
   */
  highlightOnMouseover: true,

  update: function (seriesModel, ecModel, api, start, end) {
    // Swap barMesh
    var tmp = this._prevMesh
    this._prevMesh = this._mesh
    this._mesh = tmp

    var data = seriesModel.getData()

    var dataCount = data.count()

    if (start == null) {
      start = 0
    }
    if (end == null) {
      end = dataCount
    }

    var toProcessedCount = end - start

    this._startDataIndex = start
    this._endDataIndex = end - 1

    if (!this._mesh) {
      var material = this._prevMesh && this._prevMesh.material
      this._mesh = new PointsMesh({
        // Render after axes
        renderOrder: 10,
        // FIXME
        frustumCulling: false,
      })
      if (material) {
        this._mesh.material = material
      }
    }

    // this._mesh = new PointsMesh();
    var material = this._mesh.material
    var attributes = this._mesh.geometry.attributes

    // add mesh to rootNode
    this.rootNode.remove(this._prevMesh)
    this.rootNode.add(this._mesh)

    // activate color attribute
    material.define('VERTEX_COLOR')

    /* Getting width and height one cell */
    var coordSys = seriesModel.coordinateSystem
    var xAxis = coordSys.getAxis('x')
    var yAxis = coordSys.getAxis('y')
    var cellSize = {
      w: xAxis.getBandWidth(), // * (dataCount / (xMax - xMin)),
      h: yAxis.getBandWidth(),
    }
    const half = { w: cellSize.w / 2, h: cellSize.h / 2 }
    var points = data.getLayout('points')

    // init
    attributes.position.init(toProcessedCount * 6)
    attributes.color.init(toProcessedCount * 6)

    var positionArr = attributes.position.value

    var rgbaArr = []

    // let processedCount = 0

    for (var i = 0; i < toProcessedCount; i++) {
      // const x = (i + start) % perRow
      // if (x < xMin || x > xMax) continue

      var i3 = i * 18
      var i2 = i * 2

      var centerX = points[i2]
      if (isNaN(centerX)) continue

      var centerY = points[i2 + 1]

      var px0 = centerX - half.w + 1
      var py0 = centerY - half.h

      var px1 = px0
      var py1 = py0 + cellSize.h

      var px2 = px0 + cellSize.w
      var py2 = py1

      var px3 = px2
      var py3 = py0

      // Triangle 1
      positionArr[i3] = px0
      positionArr[i3 + 1] = py0
      positionArr[i3 + 2] = Z_2D

      positionArr[i3 + 3] = px1
      positionArr[i3 + 4] = py1
      positionArr[i3 + 5] = Z_2D

      positionArr[i3 + 6] = px2
      positionArr[i3 + 7] = py2
      positionArr[i3 + 8] = Z_2D

      // Triangle 2
      positionArr[i3 + 9] = px0
      positionArr[i3 + 10] = py0
      positionArr[i3 + 11] = Z_2D

      positionArr[i3 + 12] = px2
      positionArr[i3 + 13] = py2
      positionArr[i3 + 14] = Z_2D

      positionArr[i3 + 15] = px3
      positionArr[i3 + 16] = py3
      positionArr[i3 + 17] = Z_2D

      var color = getItemVisualColor(data, i)
      var opacity = (color && getItemVisualOpacity(data, i)) || 0

      graphicGL.parseColor(color, rgbaArr)
      rgbaArr[3] *= opacity
      var col = i * 6
      attributes.color.set(col + 0, rgbaArr)
      attributes.color.set(col + 1, rgbaArr)
      attributes.color.set(col + 2, rgbaArr)
      attributes.color.set(col + 3, rgbaArr)
      attributes.color.set(col + 4, rgbaArr)
      attributes.color.set(col + 5, rgbaArr)
    }

    this._updateLabelBuilder(seriesModel, start, end)

    this._updateHandler(seriesModel, ecModel, api)

    // this._updateAnimation(seriesModel)

    this._api = api
  },

  getPointsMesh: function () {
    return this._mesh
  },

  _updateLabelBuilder: function (seriesModel, start, end) {
    var data = seriesModel.getData()
    var geometry = this._mesh.geometry
    var positionArr = geometry.attributes.position.value
    var start = this._startDataIndex
    var pointSizeScale = this._mesh.sizeScale
    this._labelsBuilder.updateData(data, start, end)

    this._labelsBuilder.getLabelPosition = function (
      dataIndex,
      positionDesc,
      distance,
    ) {
      var idx3 = (dataIndex - start) * 3
      return [positionArr[idx3], positionArr[idx3 + 1], positionArr[idx3 + 2]]
    }

    this._labelsBuilder.getLabelDistance = function (
      dataIndex,
      positionDesc,
      distance,
    ) {
      var size =
        geometry.attributes.size.get(dataIndex - start) / pointSizeScale
      return size / 2 + distance
    }
    this._labelsBuilder.updateLabels()
  },

  _updateAnimation: function (seriesModel) {
    graphicGL.updateVertexAnimation(
      [
        ['prevPosition', 'position'],
        ['prevSize', 'size'],
      ],
      this._prevMesh,
      this._mesh,
      seriesModel,
    )
  },

  _updateHandler: function (seriesModel, ecModel, api) {
    var data = seriesModel.getData()
    var pointsMesh = this._mesh
    var self = this

    var lastDataIndex = -1
    pointsMesh.seriesIndex = seriesModel.seriesIndex

    pointsMesh.off('mousemove')
    pointsMesh.off('mouseout')

    pointsMesh.on(
      'mousemove',
      function (e) {
        var dataIndex = e.vertexIndex + self._startDataIndex

        if (dataIndex !== lastDataIndex) {
          if (this.highlightOnMouseover) {
            this.downplay(data, lastDataIndex)
            this.highlight(data, dataIndex)
            this._labelsBuilder.updateLabels([dataIndex])
          }
        }

        pointsMesh.dataIndex = dataIndex
        lastDataIndex = dataIndex
      },
      this,
    )

    pointsMesh.on(
      'mouseout',
      function (e) {
        var dataIndex = e.vertexIndex + self._startDataIndex
        if (this.highlightOnMouseover) {
          this.downplay(data, dataIndex)
          this._labelsBuilder.updateLabels()
        }
        lastDataIndex = -1
        pointsMesh.dataIndex = -1
      },
      this,
    )
  },

  highlight: function (data, dataIndex) {
    if (dataIndex > this._endDataIndex || dataIndex < this._startDataIndex) {
      return
    }
    var itemModel = data.getItemModel(dataIndex)
    var emphasisItemStyleModel = itemModel.getModel('emphasis.itemStyle')
    var emphasisColor = emphasisItemStyleModel.get('color')
    var emphasisOpacity = emphasisItemStyleModel.get('opacity')
    if (emphasisColor == null) {
      var color = getItemVisualColor(data, dataIndex)
      emphasisColor = echarts.color.lift(color, -0.4)
    }
    if (emphasisOpacity == null) {
      emphasisOpacity = getItemVisualOpacity(data, dataIndex)
    }
    var colorArr = graphicGL.parseColor(emphasisColor)
    colorArr[3] *= emphasisOpacity

    const coefficient = dataIndex * 6

    this._mesh.geometry.attributes.color.set(
      coefficient - this._startDataIndex,
      colorArr,
    )
    this._mesh.geometry.attributes.color.set(
      coefficient + 1 - this._startDataIndex,
      colorArr,
    )
    this._mesh.geometry.attributes.color.set(
      coefficient + 2 - this._startDataIndex,
      colorArr,
    )
    this._mesh.geometry.attributes.color.set(
      coefficient + 3 - this._startDataIndex,
      colorArr,
    )
    this._mesh.geometry.attributes.color.set(
      coefficient + 4 - this._startDataIndex,
      colorArr,
    )
    this._mesh.geometry.attributes.color.set(
      coefficient + 5 - this._startDataIndex,
      colorArr,
    )
    this._mesh.geometry.dirtyAttribute('color')

    this._api.getZr().refresh()
  },
  downplay: function (data, dataIndex) {
    if (dataIndex > this._endDataIndex || dataIndex < this._startDataIndex) {
      return
    }
    var color = getItemVisualColor(data, dataIndex)
    var opacity = getItemVisualOpacity(data, dataIndex)

    var colorArr = graphicGL.parseColor(color)
    colorArr[3] *= opacity

    const coefficient = dataIndex * 6

    this._mesh.geometry.attributes.color.set(
      coefficient - this._startDataIndex,
      colorArr,
    )
    this._mesh.geometry.attributes.color.set(
      coefficient + 1 - this._startDataIndex,
      colorArr,
    )
    this._mesh.geometry.attributes.color.set(
      coefficient + 2 - this._startDataIndex,
      colorArr,
    )
    this._mesh.geometry.attributes.color.set(
      coefficient + 3 - this._startDataIndex,
      colorArr,
    )
    this._mesh.geometry.attributes.color.set(
      coefficient + 4 - this._startDataIndex,
      colorArr,
    )
    this._mesh.geometry.attributes.color.set(
      coefficient + 5 - this._startDataIndex,
      colorArr,
    )
    this._mesh.geometry.dirtyAttribute('color')

    this._api.getZr().refresh()
  },
}

export default SquareBuilder
