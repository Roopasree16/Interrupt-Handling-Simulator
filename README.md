# Interrupt Handling Simulator

Interactive OS interrupt handling and process scheduling simulator with Ready/Waiting/Finished queues, CPU state, ISR step-by-step visualization, and PCB tracking for learning and demos.

## Features
- Visual queues: Ready, CPU, Waiting, Finished
- ISR step list with interrupt prioritization
- Multiple scheduling algorithms: RR, FCFS, SJF, SRTF, Priority
- System clock and process execution tracking
- PCB table with state and location

## How to Run
1. Open [index.html](index.html) in your browser.
2. Click Start to move new processes into the Ready queue.
3. Use Create Process and Generate Interrupt to simulate activity.

## Controls
- Process length: total instructions for a process
- Priority: used by Priority scheduling
- Scheduling: select algorithm
- Timeslice: used by Round Robin

## Notes
- Power Cut is treated as a high-priority interrupt.
- I/O interrupt completion moves a waiting process back to Ready.

## License
MIT
