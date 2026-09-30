"use client";

import { useState } from "react";
import { DISCLAIMER } from "@/lib/disclaimer";
import type { Workbook } from "@/lib/sheet/types";
import { CompanyPicker } from "./CompanyPicker";
import { Workbench } from "./Workbench";

export function App() {
  const [workbook, setWorkbook] = useState<Workbook | null>(null);

  return (
    <div className="app">
      <header className="topbar">
        <strong className="brand">ModelSheet</strong>
        {workbook && (
          <span className="company">
            {workbook.company.name} <span className="muted">({workbook.company.ticker})</span>
          </span>
        )}
        {workbook && (
          <button
            className="link"
            onClick={() => {
              if (window.confirm("Start a new model? Changes to this one are not saved.")) setWorkbook(null);
            }}
          >
            New model
          </button>
        )}
      </header>
      <p className="disclaimer" role="note">
        {DISCLAIMER}
      </p>
      {workbook ? (
        <Workbench key={workbook.createdAt} initial={workbook} />
      ) : (
        <CompanyPicker onBuilt={setWorkbook} />
      )}
    </div>
  );
}
