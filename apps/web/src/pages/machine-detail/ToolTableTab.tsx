import { cn } from '@toolpath/ui';
import { CELL, HEAD_CELL, HEAD_ROW, ROW, TABLE } from '../../components/ui/table';
import type { ToolInfo, ToolTable } from '../../types';

interface ToolTableTabProps {
  toolTable: ToolTable;
  /** True when the machine reports which pocket holds each tool */
  hasPocketInfo: boolean;
  /** The tool in the spindle now, when the machine sends it */
  spindleTool: number | undefined;
}

/** A length or a diameter with 4 decimal places, or a dash when the machine does not send it */
const formatMeasure = (value: number | undefined) => value?.toFixed(4) ?? '—';

/** One row for each tool, with its lengths and wear. The tool in the spindle is marked. */
export function ToolTableTab({ toolTable, hasPocketInfo, spindleTool }: ToolTableTabProps) {
  const toolsByPocket = Object.entries(toolTable) as [string, ToolInfo][];

  return (
    <>
      <div className="flex flex-wrap justify-between gap-3 px-4 py-3 text-zinc-200">
        <span>The lengths and diameters are in the machine's units. The tool in the spindle is marked.</span>
        {!hasPocketInfo && <span>This machine does not send the pocket of each tool.</span>}
      </div>
      <div className="overflow-x-auto">
        <table className={cn(TABLE, 'min-w-[35rem] font-mono')}>
          <thead>
            <tr className={cn(HEAD_ROW, 'text-right font-body')}>
              {hasPocketInfo && <th scope="col" className={cn(HEAD_CELL, 'text-left')}>Pocket</th>}
              <th scope="col" className={cn(HEAD_CELL, 'text-left')}>Tool</th>
              <th scope="col" className={HEAD_CELL}>Length</th>
              <th scope="col" className={HEAD_CELL}>Length wear</th>
              <th scope="col" className={HEAD_CELL}>Diameter</th>
              <th scope="col" className={HEAD_CELL}>Diameter wear</th>
            </tr>
          </thead>
          <tbody>
            {toolsByPocket.map(([pocket, tool]) => {
              const isInSpindle = tool.toolNum === spindleTool;
              return (
                <tr key={pocket} className={cn(ROW, 'text-right', isInSpindle && 'bg-primary/14')}>
                  {hasPocketInfo && <td className={cn(CELL, 'text-left')}>P{pocket}</td>}
                  <th scope="row" className={cn(CELL, 'text-left font-medium')}>
                    T{tool.toolNum}
                    {tool.name && <span className="ml-2 font-body text-xs text-zinc-200">{tool.name}</span>}
                    {isInSpindle && <span className="ml-2 font-body text-[0.6875rem] font-bold text-primary-text">IN SPINDLE</span>}
                  </th>
                  <td className={CELL}>{formatMeasure(tool.length)}</td>
                  <td className={CELL}>{formatMeasure(tool.lengthWear)}</td>
                  <td className={CELL}>{formatMeasure(tool.diameter)}</td>
                  <td className={CELL}>{formatMeasure(tool.diameterWear)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
