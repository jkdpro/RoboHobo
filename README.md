# RoboHobo

Claude plugin for job search.

## reason and approach

### business need

I need to reduce time spent on scrolling job ads and cover more services.
In the first step I just want to get list of potentially interesting ad links at the claude CLI output.
If it works fine, I will possibly think on further automations.

### educational purposes

- practice Claude Code (in double role - as a tool to create plugin and to use this plugin),
- exercise using MCP, exercise creating skills and commands,
- play with various models, learn choosing the right one in terms of cost and effectiveness,
- apply concepts learned during "AI Coder" course by Ed Donner (https://www.udemy.com/course/ai-coder-from-vibe-coder-to-agentic-engineer/),
- accumulate doubts and questions before starting other AI-related courses.

### tech approach

- Claude Code plugin as an obvious choice:
  - because I simply want to practice claude code,
  - because I want to have all the toys (MCP, skills, commands) bundled toghether and easily deployable;
  - possibly above mentioned _further automations_ will push me to abandon plugin approach - let's see.

- I am using OpenRouter instead of Anthropics subscribtion
  - pay-as-you-go seems safer for my pocket at this stage,
  - I want to experiment with non-Anthropics models

## observations

## configuration

The planned personal configuration is kept outside this repository so that preferences remain untracked:

```text
~/robohobo/
├── searches.yaml
└── location.yaml
```

The tracked files in [`config/`](config/) are safe examples for these two personal files:

- [`config/searches.example.yaml`](config/searches.example.yaml) contains all predefined searches in one file, including per-search `remote_work` preferences.
- [`config/location.example.yaml`](config/location.example.yaml) contains the preferred location and search radius.

Copy the examples to `~/robohobo/` and replace the fictional values with personal values when configuration loading is implemented. Do not commit personal configuration files or add personal data to the examples.

A future initialization command may create the optional bootstrap file at `${XDG_CONFIG_HOME:-$HOME/.config}/robohobo/config.yaml`. That file will select an alternative data directory through `data_dir`; when it is absent, `~/robohobo` remains the default. Initialization will not create or overwrite the personal search and location files.
