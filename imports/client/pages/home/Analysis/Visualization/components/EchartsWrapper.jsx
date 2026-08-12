import React, { useRef, useState, useEffect, useCallback } from 'react';
import { Button, Form, InputNumber, Popover, Select, Space, Tooltip } from 'antd';
import { CloseOutlined, DownloadOutlined } from '@ant-design/icons';
import * as echarts from 'echarts';
import { cloneElement } from 'react';

const renderSVG = (echartsRef, width, height) => {
  // The instance can be null before mount or during the metadata-toggle remount (the heatmap's key
  // prop tears the chart down and rebuilds it). Guard so Export no-ops instead of throwing.
  const inst = echartsRef.current && echartsRef.current.getEchartsInstance
    ? echartsRef.current.getEchartsInstance()
    : null;
  if (!inst) {
    console.warn('renderSVG: chart instance not ready');
    return Promise.resolve(null);
  }

  const target = document.createElement('div');
  target.style.width = `${width}px`;
  target.style.height = `${height}px`;

  const chart = echarts.init(target, null, {
    renderer: 'svg',
  });

  let chartOptions = inst.getOption();

  // Modify series types
  (chartOptions.series || []).forEach((s) => {
    if (s.type === 'scatterGL') {
      s.type = 'scatter';
    }
    if (s.type === 'heatmapGL') {
      s.type = 'heatmap';
    }
    // if (s.type === 'linesGL') {
    //   s.type = 'linesGL';
    // }
  });

  // The offscreen chart has to render the SAME window the user is looking at, so keep the live dataZoom
  // entries instead of dropping them: getOption() reports each entry's current start/end, and the
  // percent -> category-index mapping is data-driven rather than pixel-driven, so the export clips to
  // exactly the rows on screen whatever size it is rendered at. `show: false` only stops the slider view
  // from drawing its scrollbar -- the filtering lives in the dataZoom processor, and the slider never
  // reserved grid space, so nothing but the visible rows changes. getOption() reports the window twice,
  // as percentages and as startValue/endValue; keeping only the percentages holds the offscreen chart in
  // percent rangeMode rather than leaning on echarts' precedence rule for an entry that carries both.
  let options = {
    ...chartOptions,
    animation: false,
    // filter(Boolean): getOption() blanks out entries it strips, and a spread of one would become a
    // phantom full-range dataZoom on some unrelated axis instead of being skipped.
    dataZoom: (chartOptions.dataZoom || []).filter(Boolean).map((zoom) => {
      const exportZoom = { ...zoom, show: false };
      delete exportZoom.startValue;
      delete exportZoom.endValue;
      return exportZoom;
    }),
  };

  return new Promise((resolve) => {
    let rendered = false;
    chart.on('finished', () => {
      // Only the first pass can read the chart out of the container: disposing empties it. Dispose from
      // a finally so a failed serialization still settles the Export and still tears the chart down --
      // the offscreen chart now carries the dataZoom components too, and callers already treat a null
      // result as "nothing to download".
      if (rendered) return;
      rendered = true;

      try {
        let svg = target.querySelector('svg');
        svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
        let svgData = new XMLSerializer().serializeToString(svg);
        resolve(svgData);
      } catch (err) {
        console.warn('renderSVG: could not serialize the chart', err);
        resolve(null);
      } finally {
        chart.dispose();
      }
    });

    chart.setOption(options, true, false);
  });
};

const exportSVG = async (echartsRef, width, height) => {
  let svg = await renderSVG(echartsRef, width, height);
  if (!svg) return;
  let blob = new Blob([svg], { type: 'image/svg+xml' });
  let url = URL.createObjectURL(blob);
  let a = document.createElement('a');
  a.href = url;
  a.download = 'plot.svg';
  a.click();
  URL.revokeObjectURL(url);
};

const exportPngJpeg = async (echartsRef, width, height, format, scale) => {
  let svg = await renderSVG(echartsRef, width, height);
  if (!svg) return;

  let canvas = document.createElement('canvas');
  canvas.width = width * scale;
  canvas.height = height * scale;
  let ctx = canvas.getContext('2d');
  ctx.scale(scale, scale);

  let img = new Image();
  img.onload = () => {
    if (format === 'jpeg') {
      ctx.fillStyle = 'white';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    ctx.drawImage(img, 0, 0);
    canvas.toBlob((blob) => {
      let link = document.createElement('a');
      link.download = 'plot.' + format;
      link.href = URL.createObjectURL(blob);
      link.click();
    }, 'image/' + format);
  };
  img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svg)));
};

const ExportForm = ({ echartsRef }) => {
  const [form] = Form.useForm();

  const defaultExportFormat = 'png';
  const defaultExportHeight = 600;
  const defaultExportWidth = 800;
  const defaultExportScale = 2;

  return (
    <Form
      layout={'vertical'}
      form={form}
      initialValues={{
        width: defaultExportWidth,
        height: defaultExportHeight,
        format: defaultExportFormat,
        scale: defaultExportScale,
      }}
      onFinish={async (values) => {
        const { width, height, format, scale } = values;
        if (format === 'svg') {
          await exportSVG(echartsRef, width, height);
        } else {
          await exportPngJpeg(echartsRef, width, height, format, scale);
        }
      }}
    >
      <Space className={'items-end'}>
        <Form.Item label={'Width'} name={'width'} className={'mb-0'}>
          <InputNumber min={10} step={100} />
        </Form.Item>
        <Form.Item label={'Height'} name={'height'} className={'mb-0'}>
          <InputNumber min={10} step={100} />
        </Form.Item>
        <Form.Item label={'Format'} name={'format'} className={'mb-0 w-20'}>
          <Select
            options={[
              { label: 'PNG', value: 'png' },
              { label: 'JPEG', value: 'jpeg' },
              { label: 'SVG', value: 'svg' },
            ]}
          />
        </Form.Item>
        <Form.Item
          className={'mb-0'}
          label={'Scale'}
          name={'scale'}
          hidden={form.getFieldValue('format') === 'svg'}
        >
          <InputNumber min={1} max={10} step={1} />
        </Form.Item>
        <Button type={'primary'} htmlType={'submit'}>Export</Button>
      </Space>
    </Form>
  );
};

const PlotToolBox = React.forwardRef(({ echartsRef, placement }, ref) => {
  const [showToolbox, setShowToolbox] = useState(true);

  if (!placement) placement = 'bottom-right';

  return (
    <Space
      size={2}
      className={'absolute p-1 opacity-0 transition-opacity duration-200'}
      style={{
        top: ['top-middle', 'top-left', 'top-right'].includes(placement) ? 0 : undefined,
        bottom: ['bottom-middle', 'bottom-left', 'bottom-right'].includes(placement) ? 0 : undefined,
        left: ['top-left', 'bottom-left'].includes(placement) ? 0 : ['top-middle', 'bottom-middle'].includes(placement) ? '50%' : undefined,
        right: ['top-right', 'bottom-right'].includes(placement) ? 0 : ['top-middle', 'bottom-middle'].includes(placement) ? '50%' : undefined,
        transform: ['top-middle', 'bottom-middle'].includes(placement) ? 'translateX(-50%)' : undefined,
        display: showToolbox ? 'flex' : 'none',
        zIndex: 1000,
      }}
      ref={ref}
    >
      <Popover
        trigger={'click'}
        content={<ExportForm echartsRef={echartsRef} />}
      >
        <Tooltip title={'Export'}>
          <Button>
            <DownloadOutlined />
          </Button>
        </Tooltip>
      </Popover>
      <Tooltip title={'Hide toolbox. Go to Settings to enable it again.'}>
        <Button onClick={() => setShowToolbox(false)}>
          <CloseOutlined />
        </Button>
      </Tooltip>
    </Space>
  );
});

// Forward a value to a ref whether it's an object ref (useRef/createRef) or a callback ref.
const assignRef = (ref, value) => {
  if (!ref) return;
  if (typeof ref === 'function') ref(value);
  else ref.current = value;
};

const EchartsWrapper = ({ children, style }) => {
  const toolBoxRef = useRef(null);
  const echartsRef = useRef(null);

  // Fan the chart instance out to BOTH the wrapper's echartsRef (used by the export toolbox) AND the
  // child's own ref, if it passed one. A bare cloneElement(child, { ref: echartsRef }) would OVERRIDE
  // the child's ref, leaving e.g. HeatmapChart's chartRef null and its axis-label showTip handler a
  // dead no-op. NOTE: reading children.ref is valid in React 18; on a React 19 bump this becomes
  // children.props.ref.
  const childRef = children.ref;
  // useCallback keeps the ref identity stable across renders (childRef is a stable useRef object),
  // so React doesn't detach/reattach — and re-null — the instance on every parent re-render.
  const mergedRef = useCallback((instance) => {
    echartsRef.current = instance;
    assignRef(childRef, instance);
  }, [childRef]);
  children = cloneElement(children, { ref: mergedRef });

  return (
    <div
      className={'relative'}
      style={style}
      onMouseEnter={() => {
        if (toolBoxRef.current) toolBoxRef.current.style.opacity = 1;
      }}
      onMouseLeave={() => {
        if (toolBoxRef.current) toolBoxRef.current.style.opacity = 0;
      }}
    >
      <PlotToolBox ref={toolBoxRef} echartsRef={echartsRef} />
      {children}
    </div>
  );
};

export default EchartsWrapper;