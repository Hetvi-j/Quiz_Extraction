import React from 'react';
import {
    PieChart,
    Pie,
    Cell,
    Tooltip,
    Legend,
    ResponsiveContainer,
    LabelList // For showing values directly on slices
} from 'recharts';

/**
 * Renders a Pie Chart showing the distribution of question difficulty levels.
 * * @param {Array<Object>} data - Array of question stats (e.g., [{difficultyLevel: "Easy", ...}])
 */
const AnalysisPieChart = ({ data }) => {
    if (!data || data.length === 0) {
        return (
            <div className="flex items-center justify-center h-full text-gray-500">
                No data available to generate pie chart.
            </div>
        );
    }

    // Aggregate data by difficulty level
    const difficultyCounts = data.reduce((acc, question) => {
        const level = question.difficultyLevel || 'Unknown'; // Handle cases where difficultyLevel might be missing
        acc[level] = (acc[level] || 0) + 1;
        return acc;
    }, {});

    const pieChartData = Object.keys(difficultyCounts).map(level => ({
        name: level,
        value: difficultyCounts[level]
    }));

    // Define colors for each difficulty level
    const COLORS = {
        'Easy': '#82ca9d',   // Greenish
        'Medium': '#ffc658', // Yellowish
        'Hard': '#ff7300',   // Orangish/Reddish
        'Unknown': '#cccccc' // Gray for unknown
    };

    return (
        <ResponsiveContainer width="100%" height="100%">
            <PieChart>
                <Pie
                    data={pieChartData}
                    cx="50%" // Center X position
                    cy="50%" // Center Y position
                    labelLine={false} // Hide lines connecting labels to slices
                    outerRadius={120} // Size of the pie chart
                    fill="#8884d8" // Default fill, overridden by Cell
                    dataKey="value" // The key in pieChartData that holds the numerical value
                >
                    {pieChartData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS[entry.name]} />
                    ))}
                    {/* LabelList to show difficulty count directly on the slices */}
                    <LabelList 
                        dataKey="value" 
                        position="inside" 
                        fill="#fff" // White color for text
                        stroke="none" 
                        fontSize={14} 
                        fontWeight="bold"
                        formatter={(value) => `${value}`} // Just show the count
                    />
                </Pie>
                <Tooltip />
                <Legend 
                    verticalAlign="bottom" 
                    align="center" 
                    layout="horizontal"
                    iconType="circle"
                />
            </PieChart>
        </ResponsiveContainer>
    );
};

export default AnalysisPieChart;