import * as echarts from 'echarts/lib/echarts'
import graphicGL from 'echarts-gl/src/util/graphicGL'
import ViewGL from 'echarts-gl/src/core/ViewGL'

import PointsBuilder from '/imports/echarts/common/PointsBuilder.js'
import GLViewHelper from 'echarts-gl/src/chart/common/GLViewHelper'
import _ from 'lodash'

//a workaround for the error "setting 'blend'
window.addEventListener('error', function (e) {
  if (e?.error?.message?.match("setting 'blend'")) {
    e.preventDefault()
  }
  return false
})

import '/imports/echarts/override'

const seriesMap = new Map()
import { indexDisplayList } from '/imports/echarts/hoverIndex'

export default echarts.ChartView.extend({
  type: 'scatterGL',

  __ecgl__: true,
  hasSymbolVisual: true,

  init: function (ecModel, api) {
    this.groupGL = new graphicGL.Node()
    this.viewGL = new ViewGL('orthographic')

    this.viewGL.add(this.groupGL)

    this._pointsBuilderList = []
    this._currentStep = 0

    this._sizeScale = 1

    this._glViewHelper = new GLViewHelper(this.viewGL)
  },

  render: function (seriesModel, ecModel, api) {
    this.groupGL.removeAll()
    this._glViewHelper.reset(seriesModel, api)

    let dataCount = seriesModel.getData().count()

    if (!dataCount) {
      this.group.removeAll()
      return
    }

    var pointsBuilder = this._pointsBuilderList[0]
    if (!pointsBuilder) {
      pointsBuilder = this._pointsBuilderList[0] = new PointsBuilder(true, api)
    }
    this._pointsBuilderList.length = 1

    this.groupGL.add(pointsBuilder.rootNode)

    this._removeTransformInPoints(seriesModel.getData().getLayout('points'))
    pointsBuilder.update(seriesModel, ecModel, api)

    this.viewGL.setPostEffect(seriesModel.getModel('postEffect'), api)

    // Just for fun
    seriesModel.option.tooltip = api.getOption()?.tooltip
    this.group.removeAll()
    this._tooltipHack(seriesModel, api)
  },

  incrementalPrepareRender: function (seriesModel, ecModel, api) {
    this.groupGL.removeAll()
    this._glViewHelper.reset(seriesModel, api)

    this._currentStep = 0

    this.viewGL.setPostEffect(seriesModel.getModel('postEffect'), api)
  },

  incrementalRender: function (params, seriesModel, ecModel, api) {
    if (params.end <= params.start) {
      return
    }

    var pointsBuilder = this._pointsBuilderList[this._currentStep]
    if (!pointsBuilder) {
      pointsBuilder = new PointsBuilder(true, api)
      this._pointsBuilderList[this._currentStep] = pointsBuilder
    }
    this.groupGL.add(pointsBuilder.rootNode)

    this._removeTransformInPoints(seriesModel.getData().getLayout('points'))

    pointsBuilder.setSizeScale(this._sizeScale)
    pointsBuilder.update(seriesModel, ecModel, api, params.start, params.end)

    api.getZr().refresh()

    this._currentStep++

    this._tooltipHack(seriesModel, api)
  },

  _tooltipHack: function (seriesModel, api) {
    seriesMap.set(seriesModel.id, seriesModel)
    this._debounceTooltipHack(this, seriesModel, api)
  },

  _debounceTooltipHack: _.debounce((self, seriesModel, api) => {
    let seriesModels = seriesMap.values()
    seriesModels.forEach(seriesModel => {
      self._tooltipHackRun(seriesModel, api)
    })
    seriesMap.clear()
  }, 100),

  _tooltipHackRun: function (seriesModel, api) {
    const data = seriesModel.getData()

    data._itemVisuals.forEach((e, i) => {
      let x = data._layout.points[i * 2]
      let y = data._layout.points[i * 2 + 1]

      data.setItemGraphicEl(i, {
        i,
        x,
        y,
        width: 0,
        height: 0,
        clone() {
          return _.clone(this)
        },
        applyTransform() {},
        getBoundingRect() {
          return this
        },
        contain(_x, _y) {
          return x - 2 < _x && x + 2 > _x && y - 2 < _y && y + 2 > _y
        },
        getClipPath() {},
        trigger() {},
        __seriesIndex: seriesModel.componentIndex,
        __adhoc: true,
        __highDownDispatcher: true,
        __highByOuter: 0,
        _symbolType: 'circle',
        __dirty: true,
        beforeUpdate() {},
        afterUpdate() {},
        update() {},
        getTextGuideLine() {},
        getTextContent() {},
        shouldBePainted() {
          return false
        },
        innerBeforeBrush() {},
        innerAfterBrush() {},
        getRawIndex() {
          return i
        },
        removeSelfFromZr() {},
        z: 0,
        z2: 0,
        zlevel: 0,
      })
    })

    const zr = api.getZr()
    if (!zr) return

    const storage = zr.storage

    let group = storage._roots.find(
      e =>
        e.__ecComponentInfo?.mainType === 'series' &&
        e.__ecComponentInfo?.index === seriesModel.componentIndex,
    )

    if (group) {
      setTimeout(() => {
        storage._displayList = storage._displayList.filter(
          e => !e.__adhoc || e.__seriesIndex !== seriesModel.componentIndex,
        )
        storage._displayList = storage._displayList.concat(data._graphicEls)
        storage._displayListLen = storage._displayList.length

        group._children = data._graphicEls

        indexDisplayList(storage)
      }, 10)
    }
  },

  updateTransform: function (seriesModel, ecModel, api) {
    if (seriesModel.coordinateSystem.getRoamTransform) {
      this._glViewHelper.updateTransform(seriesModel, api)

      var zoom = this._glViewHelper.getZoom()
      var sizeScale = Math.max(
        (seriesModel.get('zoomScale') || 0) * (zoom - 1) + 1,
        0,
      )
      this._sizeScale = sizeScale

      this._pointsBuilderList.forEach(function (pointsBuilder) {
        pointsBuilder.setSizeScale(sizeScale)
      })
    }
  },

  _removeTransformInPoints: function (points) {
    if (!points) {
      return
    }
    var pt = []
    for (var i = 0; i < points.length; i += 2) {
      pt[0] = points[i]
      pt[1] = points[i + 1]
      this._glViewHelper.removeTransformInPoint(pt)
      points[i] = pt[0]
      points[i + 1] = pt[1]
    }
  },

  dispose: function () {
    this.groupGL.removeAll()
    this._pointsBuilderList.forEach(function (pointsBuilder) {
      pointsBuilder.dispose()
    })
  },

  remove: function () {
    this.groupGL.removeAll()
  },
})