# CAO Status Viewer

This repository provides a read-only status API and visual viewer for a CAO deployment running on a home server. Homepage.dev links to the viewer, which reads through the status API rather than calling CAO directly.

## Language

**CAO**:
The CLI Agent Orchestrator service that owns agent profiles, workflow definitions, workflow runs, and session state.

**Profile**:
An installed agent configuration and prompt that describes how one CAO agent behaves.
_Avoid_: agent, workflow, run

**Workflow definition**:
A saved, reusable multi-step agent pipeline that describes work to perform.
_Avoid_: workflow run, execution

**Workflow run**:
One execution of a workflow definition, with its own state and retained results.
_Avoid_: workflow

**Workflow graph**:
The normalized visual representation of a workflow definition as nodes and directed edges. A dynamic workflow may not have a complete graph.
_Avoid_: workflow run graph

**Status API**:
The read-only HTTP adapter in this repository between the viewer/Homepage.dev and CAO.
_Avoid_: CAO API

**Status app**:
The read-only browser application that visualizes profiles and workflow definitions using the Status API.
_Avoid_: Homepage widget
