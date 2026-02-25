import * as React from "react";
import type { SVGProps } from "react";
const SvgInbox = (props: SVGProps<SVGSVGElement>) => (
  <svg
    viewBox="0 0 16 16"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    {...props}
  >
    <path
      d="M14 8H10.6667L9.33333 10H6.66667L5.33333 8H2M14 8V12C14 12.3536 13.8595 12.6928 13.6095 12.9428C13.3594 13.1929 13.0203 13.3333 12.6667 13.3333H3.33333C2.97971 13.3333 2.64057 13.1929 2.39052 12.9428C2.14048 12.6928 2 12.3536 2 12V8M14 8L11.78 3.56C11.6699 3.33964 11.5012 3.15339 11.2929 3.02212C11.0846 2.89084 10.8448 2.81952 10.6 2.81667H5.4C5.15524 2.81952 4.91537 2.89084 4.70709 3.02212C4.4988 3.15339 4.33014 3.33964 4.22 3.56L2 8"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);
export default SvgInbox;
