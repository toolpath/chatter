import { cn } from '@toolpath/ui';
import { useEffect, useRef, useState, type PointerEvent } from 'react';
import type { HistoryPoint } from '../../api/history';
import { CHOICE_HEIGHT, ChoiceMenu } from '../../components/ui/ChoiceMenu';
import { RangeButtons } from '../../components/ui/RangeButtons';
import type { Machine } from '../../types';
import type { ChartValue } from './chartValues';
import {
  axisTicks,
  CHART_RANGES,
  formatChartNumber,
  lineParts,
  nearestPoint,
  timeLabels,
  type ChartRange,
  type TimeLabel,
} from './historyChart';
import { useChartHistory, type HistoryStatus } from './useChartHistory';

const MARGIN = { top: 12, right: 16, bottom: 26, left: 52 };
/** The space between a value label and the left end of its grid line */
const VALUE_LABEL_GAP = 8;
/** The distance from the bottom of the chart to the time labels */
const TIME_LABEL_BOTTOM = 6;
/** The space between the hover line and the tooltip */
const TOOLTIP_GAP = 12;
/** About the width of the tooltip, so a tooltip near the right edge stays inside the chart */
const TOOLTIP_WIDTH = 150;
const AXIS_LABEL_CLASS = 'fill-zinc-300 font-mono text-[0.6875rem]';
/** The size of an element, kept current when the page changes size */
function useBoxSize<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const element = ref.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => setSize({ width: entry.contentRect.width, height: entry.contentRect.height }));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return { ref, ...size };
}

/** The newest value from the live machine events, or null when the machine is not connected */
function livePointOf(machine: Machine, value: ChartValue): HistoryPoint | null {
  const liveValue = value.liveValueOf(machine);
  if (!machine.connected || !machine.lastPollTime || liveValue === undefined) return null;
  return { time: Date.parse(machine.lastPollTime), value: liveValue };
}

interface MachineHistoryChartProps {
  machine: Machine;
  /** The values that the menu offers */
  values: ChartValue[];
  /** The value that the chart shows */
  value: ChartValue;
  onChoose: (id: ChartValue['id']) => void;
  className?: string;
}

/** One machine value over time, with a menu for the value and buttons for the time range */
function MachineHistoryChart({ machine, values, value, onChoose, className }: MachineHistoryChartProps) {
  const [range, setRange] = useState<ChartRange>(CHART_RANGES[0]);
  const livePoint = livePointOf(machine, value);
  const { points, status, now, gapMs } = useChartHistory(machine.id, value.id, livePoint, range);
  const { ref, width, height } = useBoxSize<HTMLDivElement>();

  return (
    <section
      aria-label={`${value.name} chart`}
      className={cn('flex min-w-0 flex-col gap-2.5 rounded-xl border border-zinc-800 bg-zinc-900 px-5 py-4', className)}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <ChartTitle values={values} value={value} onChoose={onChoose} />
          <span className="text-xs text-zinc-300">{value.description} in the last {range.words}.</span>
        </div>
        <RangeButtons options={CHART_RANGES} value={range} onChange={setRange} />
      </div>
      {/* The box sets the chart height in rem, so the chart follows the page scale */}
      <div ref={ref} className="relative h-[13.75rem]">
        {points.length > 0 && width > 0 ? (
          <ChartPlot
            points={points}
            value={value}
            now={now}
            range={range}
            gapMs={gapMs}
            connected={machine.connected}
            width={width}
            height={height}
          />
        ) : (
          <p className="m-0 flex h-full items-center justify-center text-center text-zinc-300">{messageFor(status, value, range)}</p>
        )}
      </div>
    </section>
  );
}

interface ChartTitleProps {
  values: ChartValue[];
  value: ChartValue;
  onChoose: (id: ChartValue['id']) => void;
}

/** The name of the value, as a dropdown when the machine sends more than one value. The unit is next to it. */
function ChartTitle({ values, value, onChoose }: ChartTitleProps) {
  return (
    <h2 className="m-0 flex items-center gap-1.5 text-base font-bold">
      {values.length > 1 ? <ChoiceMenu label="Value in the chart" choices={values} value={value.id} onChoose={onChoose} /> : value.name}
      {value.unit && (
        <span className={cn(CHOICE_HEIGHT, 'inline-flex items-center rounded bg-zinc-800 px-1.5 font-mono text-[0.6875rem] font-medium text-zinc-200')}>
          {value.unit}
        </span>
      )}
    </h2>
  );
}

function messageFor(status: HistoryStatus, value: ChartValue, range: ChartRange): string {
  const name = value.name.toLowerCase();
  if (status === 'loading') return `Loading the ${name} history…`;
  if (status === 'failed') return `Could not load the ${name} history. Reload the page to try again.`;
  return `No ${name} in the last ${range.words}. Chatter saves it while the machine is connected.`;
}

interface ChartPlotProps {
  points: HistoryPoint[];
  value: ChartValue;
  now: number;
  range: ChartRange;
  gapMs: number;
  connected: boolean;
  width: number;
  height: number;
}

function ChartPlot({ points, value, now, range, gapMs, connected, width, height }: ChartPlotProps) {
  const [hovered, setHovered] = useState<HistoryPoint | undefined>();
  const ticks = axisTicks(highestValue(points), value.smallestAxisTop);
  const scale = chartScale({ width, height, startTime: now - range.ms, rangeMs: range.ms, topValue: ticks[ticks.length - 1] });
  const parts = lineParts(points, now, connected, gapMs);
  const newest = points[points.length - 1];

  const showNearest = (event: PointerEvent<SVGSVGElement>) => {
    const offsetX = event.clientX - event.currentTarget.getBoundingClientRect().left;
    setHovered(nearestPoint(points, scale.timeAt(offsetX)));
  };

  return (
    <>
      <svg
        width={width}
        height={height}
        role="img"
        aria-label={`${value.name} in the last ${range.words}. Newest value: ${value.format(newest.value)}.`}
        onPointerMove={showNearest}
        onPointerLeave={() => setHovered(undefined)}
        className="block"
      >
        <ValueAxis ticks={ticks} scale={scale} width={width} />
        <TimeAxis labels={timeLabels(range.ms, now)} scale={scale} height={height} />
        {parts.map(part => (
          <path key={part[0].time} d={linePath(part, scale)} fill="none" strokeWidth={2} strokeLinejoin="round" className="stroke-primary" />
        ))}
        {hovered && <HoverMarker point={hovered} scale={scale} />}
      </svg>
      {hovered && (
        <HoverTooltip point={hovered} value={value} left={Math.min(scale.x(hovered.time) + TOOLTIP_GAP, width - TOOLTIP_WIDTH)} />
      )}
    </>
  );
}

function highestValue(points: HistoryPoint[]): number {
  return points.reduce((highest, point) => Math.max(highest, point.value), 0);
}

interface ChartScale {
  /** The x position of a time */
  x: (time: number) => number;
  /** The y position of a value */
  y: (value: number) => number;
  /** The time at an x position from the left edge of the chart: the reverse of `x` */
  timeAt: (offsetX: number) => number;
}

interface ChartScaleOptions {
  width: number;
  height: number;
  /** The time at the left edge of the plot */
  startTime: number;
  rangeMs: number;
  /** The value at the top of the plot */
  topValue: number;
}

/** Turns times and values into positions in the chart, inside the margins */
function chartScale({ width, height, startTime, rangeMs, topValue }: ChartScaleOptions): ChartScale {
  const plotWidth = width - MARGIN.left - MARGIN.right;
  const plotHeight = height - MARGIN.top - MARGIN.bottom;
  return {
    x: time => MARGIN.left + ((time - startTime) / rangeMs) * plotWidth,
    y: value => MARGIN.top + plotHeight - (value / topValue) * plotHeight,
    timeAt: offsetX => startTime + ((offsetX - MARGIN.left) / plotWidth) * rangeMs,
  };
}

/** The SVG path of one part of the line: "M" to its first point, then "L" to each next point */
function linePath(part: HistoryPoint[], scale: ChartScale): string {
  return part.map((point, index) => `${index ? 'L' : 'M'}${scale.x(point.time)},${scale.y(point.value)}`).join('');
}

/** A grid line and a label for each value on the value axis. The line at 0 is brighter. */
function ValueAxis({ ticks, scale, width }: { ticks: number[]; scale: ChartScale; width: number }) {
  return (
    <>
      {ticks.map(tick => {
        const tickY = scale.y(tick);
        return (
          <g key={tick}>
            <line
              x1={MARGIN.left}
              x2={width - MARGIN.right}
              y1={tickY}
              y2={tickY}
              className={tick === 0 ? 'stroke-zinc-500' : 'stroke-zinc-800'}
              strokeWidth={1}
            />
            <text x={MARGIN.left - VALUE_LABEL_GAP} y={tickY} textAnchor="end" dominantBaseline="middle" className={AXIS_LABEL_CLASS}>
              {formatChartNumber(tick, true)}
            </text>
          </g>
        );
      })}
    </>
  );
}

/** The time labels under the plot. The first and the last label stay inside the chart. */
function TimeAxis({ labels, scale, height }: { labels: TimeLabel[]; scale: ChartScale; height: number }) {
  return (
    <>
      {labels.map(({ time, text }, index) => (
        <text
          key={index}
          x={scale.x(time)}
          y={height - TIME_LABEL_BOTTOM}
          textAnchor={timeLabelAnchor(index, labels.length)}
          className={AXIS_LABEL_CLASS}
        >
          {text}
        </text>
      ))}
    </>
  );
}

function timeLabelAnchor(index: number, labelCount: number): 'start' | 'middle' | 'end' {
  if (index === 0) return 'start';
  if (index === labelCount - 1) return 'end';
  return 'middle';
}

/** A line down from the top of the plot, and a dot on the hovered point */
function HoverMarker({ point, scale }: { point: HistoryPoint; scale: ChartScale }) {
  const pointX = scale.x(point.time);
  return (
    <>
      <line x1={pointX} x2={pointX} y1={MARGIN.top} y2={scale.y(0)} strokeWidth={1} className="stroke-zinc-400" />
      <circle cx={pointX} cy={scale.y(point.value)} r={4} strokeWidth={2} className="fill-primary stroke-zinc-900" />
    </>
  );
}

/** The value and the time of the hovered point, in a box over the chart */
function HoverTooltip({ point, value, left }: { point: HistoryPoint; value: ChartValue; left: number }) {
  return (
    <div
      className="pointer-events-none absolute flex flex-col gap-0.5 rounded-md border border-zinc-700 bg-zinc-950 px-2.5 py-1.5 text-xs"
      style={{ left, top: MARGIN.top }}
    >
      <strong className="font-mono">{value.format(point.value)}</strong>
      <span className="text-zinc-300">{new Date(point.time).toLocaleString()}</span>
    </div>
  );
}

export default MachineHistoryChart;
