"use client";

import { AdminPageTitle } from "@/components/admin/Title";
import { FiSearch } from "react-icons/fi";
import { WebSearchConfiguration } from "./WebSearchConfiguration";

export default function Page() {
  return (
    <div className="mx-auto container">
      <AdminPageTitle
        title="Web Search Setup"
        icon={<FiSearch size={32} className="my-auto" />}
      />

      <WebSearchConfiguration />
    </div>
  );
}
