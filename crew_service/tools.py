import json
from typing import Any

from crewai.tools import BaseTool
from pydantic import BaseModel, Field


class EvidenceSectionInput(BaseModel):
    section: str = Field(description="One of the read-only evidence sections listed by the tool.")


class ContextEvidenceTool(BaseTool):
    name: str = "Digital Twin Evidence Lookup"
    description: str = "Read a permitted section of the supplied digital-twin evidence bundle."
    args_schema: type[BaseModel] = EvidenceSectionInput
    context: dict[str, Any] = Field(exclude=True)
    allowed_sections: list[str] = Field(exclude=True)

    def _run(self, section: str) -> str:
        if section not in self.allowed_sections:
            raise ValueError(f"Evidence section '{section}' is not available to this agent.")
        if section not in self.context:
            raise ValueError(f"Evidence section '{section}' is missing from the request.")
        return json.dumps(self.context[section], ensure_ascii=True, separators=(",", ":"))
