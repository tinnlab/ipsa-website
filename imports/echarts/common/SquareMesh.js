import graphicGL from 'echarts-gl/lib/util/graphicGL'

import sdfSpriteGLSL from './sdfSprite.glsl.js'
graphicGL.Shader.import(sdfSpriteGLSL)

var SquareMesh = graphicGL.Mesh.extend(
  function () {
    var geometry = new graphicGL.Geometry({
      dynamic: true,
      attributes: {
        color: new graphicGL.Geometry.Attribute('color', 'float', 4, 'COLOR'),
        position: new graphicGL.Geometry.Attribute(
          'position',
          'float',
          3,
          'POSITION',
        ),
        prevPosition: new graphicGL.Geometry.Attribute(
          'prevPosition',
          'float',
          3,
        ),
        prevSize: new graphicGL.Geometry.Attribute('prevSize', 'float', 1),
      },
    })

    var material = new graphicGL.Material({
      shader: graphicGL.createShader('ecgl.sdfSprite'),
    })

    material.define('both', 'VERTEX_COLOR')
    material.define('both', 'HEATMAP')

    // Custom pick methods.
    geometry.pick = this._pick.bind(this)

    return {
      geometry: geometry,
      material: material,
      mode: graphicGL.Mesh.TRIANGLES,

      sizeScale: 1,
    }
  },
  {
    _pick: function (x, y, renderer, camera, renderable, out) {
      var viewport = renderer.viewport
      var halfWidth = viewport.width / 2
      var halfHeight = viewport.height / 2
      var cx = x * halfWidth + halfWidth
      var cy = -1 * y * halfHeight + halfHeight

      // From near to far. indices have been sorted.
      for (var i = this.geometry.vertexCount; i >= 0; i -= 6) {
        var idx
        if (!this.geometry.indices) {
          idx = i
        } else {
          idx = this.geometry.indices[i]
        }

        var point = new graphicGL.Vector3()
        var pointPosition = this.geometry.attributes.position.get(
          idx,
          point.array,
        )
        var pointX = pointPosition[0]
        var pointY = pointPosition[1]

        // getting position two diagonal points for calculation cell width/height
        var cellP1 = this.geometry.attributes.position.get(
          idx,
          new graphicGL.Vector3(),
        )
        var cellP2 = this.geometry.attributes.position.get(
          idx + 2,
          new graphicGL.Vector3(),
        )
        var cellWidth = cellP2[0] - cellP1[0]
        var cellHeight = cellP2[1] - cellP1[1]

        if (
          cx > pointX &&
          cx < pointX + cellWidth &&
          cy > pointY &&
          cy < pointY + cellHeight
        ) {
          var color = this.geometry.attributes.color.get(
            idx,
            new graphicGL.Vector4(),
          )
          if (color[0] === 0 && color[1] === 0 && color[2] === 0) {
            return
          }

          var pointWorld = new graphicGL.Vector3()
          graphicGL.Vector3.transformMat4(
            pointWorld,
            point,
            this.worldTransform,
          )
          out.push({
            vertexIndex: idx / 6,
            point: [point],
            pointWorld: pointWorld,
            target: this,
            distance: pointWorld.distance(camera.getWorldPosition()),
          })
        }
      }
    },
  },
)

export default SquareMesh
