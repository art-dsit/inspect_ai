"""WebLLM model provider — runs LLMs in the browser via WebGPU.

This provider only works inside Pyodide (Python-in-the-browser). It bridges
to a JavaScript WebLLM engine that must be initialised before the eval starts.

The JavaScript side exposes a global ``webllmGenerate(messagesJson)`` function
that accepts an OpenAI-style messages array (as a JSON string) and returns a
JSON string with ``{content, usage: {prompt_tokens, completion_tokens}}``.
"""

from __future__ import annotations

import json
from typing import Any

from inspect_ai._util.content import Content, ContentReasoning, ContentText
from inspect_ai.tool import ToolChoice, ToolInfo

from .._chat_message import ChatMessage
from .._generate_config import GenerateConfig
from .._model import ModelAPI
from .._model_call import ModelCall
from .._model_output import ModelOutput, ModelUsage
from .._reasoning import parse_content_with_reasoning, reasoning_to_think_tag


class WebLLMAPI(ModelAPI):
    """Model provider that calls WebLLM running in the browser via Pyodide JS interop."""

    def __init__(
        self,
        model_name: str,
        base_url: str | None = None,
        api_key: str | None = None,
        config: GenerateConfig = GenerateConfig(),
        **model_args: dict[str, Any],
    ) -> None:
        super().__init__(model_name, base_url, api_key, [], config)

    async def generate(
        self,
        input: list[ChatMessage],
        tools: list[ToolInfo],
        tool_choice: ToolChoice,
        config: GenerateConfig,
    ) -> ModelOutput | tuple[ModelOutput, ModelCall]:
        # Convert Inspect messages to OpenAI-format dicts
        messages = []
        for msg in input:
            content = msg.content
            # Flatten Content lists to plain text for WebLLM,
            # re-serialising ContentReasoning as <think> tags so the model
            # sees its own prior reasoning in the conversation history.
            if isinstance(content, list):
                text_parts = []
                for part in content:
                    if isinstance(part, ContentReasoning):
                        text_parts.append(reasoning_to_think_tag(part))
                    elif isinstance(part, ContentText):
                        text_parts.append(part.text)
                    elif hasattr(part, "text"):
                        text_parts.append(part.text)
                content = "\n".join(text_parts) if text_parts else ""
            messages.append({"role": msg.role, "content": content})

        request_json = json.dumps(
            {
                "messages": messages,
                "temperature": config.temperature,
                "max_tokens": config.max_tokens,
            }
        )

        # Call into JavaScript via Pyodide's js module
        import js  # type: ignore[import-not-found]

        # webllmGenerate is an async JS function that returns a JSON string
        result_json = await js.webllmGenerate(request_json)
        result = json.loads(result_json)

        raw_content: str = result.get("content", "")
        usage_data = result.get("usage", {})

        usage = ModelUsage(
            input_tokens=usage_data.get("prompt_tokens", 0),
            output_tokens=usage_data.get("completion_tokens", 0),
            total_tokens=usage_data.get("prompt_tokens", 0)
            + usage_data.get("completion_tokens", 0),
        )

        # Parse <think> tags from models that emit them (e.g. Qwen3)
        clean_text, reasoning = parse_content_with_reasoning(raw_content)

        assistant_content: str | list[Content]
        if reasoning:
            assistant_content = [
                ContentReasoning(
                    reasoning=reasoning.reasoning,
                    signature=reasoning.signature,
                    redacted=reasoning.redacted,
                    summary=reasoning.summary,
                ),
                ContentText(text=clean_text),
            ]
        else:
            assistant_content = clean_text

        output = ModelOutput.from_content(
            model=self.model_name,
            content=assistant_content,
            stop_reason="stop",
        )
        output.usage = usage

        model_call = ModelCall.create(
            {"model": self.model_name, "messages": messages},
            {"content": raw_content},
        )
        return output, model_call
