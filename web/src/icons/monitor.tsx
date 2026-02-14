import * as React from "react";
import type { SVGProps } from "react";
const SvgMonitor = (props: SVGProps<SVGSVGElement>) => (
  <svg
    viewBox="0 0 16 16"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    {...props}
  >
    <rect x={2} y={2.5} width={12} height={8.5} rx={1.5} strokeWidth={1.5} />
    <path
      d="M5.5 14h5M8 11v3"
      strokeWidth={1.5}
      strokeLinecap="round"
    />
  </svg>
);
export default SvgMonitor;
