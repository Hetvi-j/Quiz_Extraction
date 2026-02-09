import React from 'react';
import {
    BarChart,
    Bar,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    Legend,
    ResponsiveContainer
} from 'recharts';

/**
 * Renders a Bar Chart visualizing quiz performance statistics.
 * Data source is the analysisData array from the API.
 * * @param {Array<Object>} data - Array of question stats (e.g., [{questionNumber: 1, correctCount: 50, ...}])
 */
const AnalysisBarGraph = ({ data }) => {
    
    // Ensure data is not empty before rendering the chart
    if (!data || data.length === 0) {
        return (
            <div className="flex items-center justify-center h-full text-gray-500">
                No data available to generate chart.
            </div>
        );
    }
    
    // Convert numerical fields to numbers and ensure QuestionNumber is handled as a string for XAxis labels
    const chartData = data.map(item => ({
        ...item,
        questionNumber: `Q${item.questionNumber}`, // Format X-axis labels nicely
        correctCount: Number(item.correctCount),
        accuracy: Number(item.accuracy),
    }));

    return (
        <ResponsiveContainer width="100%" height="100%">
            <BarChart 
                data={chartData} 
                margin={{ top: 10, right: 30, left: 0, bottom: 5 }}
            >
                {/* Background grid lines */}
                <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" />
                
                {/* X-Axis: Question Number */}
                <XAxis 
                    dataKey="questionNumber" 
                    interval={0} // Show all labels
                    tickLine={false} 
                    height={50} // Provide space for labels
                    angle={-45} // Rotate labels for better fit if many questions
                    textAnchor="end"
                />
                
                {/* Y-Axis: Correct Count */}
                <YAxis 
                    label={{ 
                        value: 'Number of Students Correct', 
                        angle: -90, 
                        position: 'insideLeft', 
                        style: { textAnchor: 'middle' } 
                    }}
                    allowDecimals={false}
                    // Optional: Set domain [0, max_attempts] if max attempts is constant
                />
                
                {/* Tooltip on hover */}
                <Tooltip 
                    cursor={{ fill: '#f0f0f0' }}
                    contentStyle={{ borderRadius: '4px', border: '1px solid #ccc' }}
                    labelFormatter={(label) => `Question: ${label}`}
                />
                
                {/* Legend for the bar color */}
                <Legend 
                    verticalAlign="top" 
                    height={36} 
                />

                {/* The Bar itself */}
                <Bar 
                    dataKey="correctCount" 
                    name="Correct Answers"
                    fill="#4f46e5" // Indigo color
                    radius={[4, 4, 0, 0]} // Rounded top corners
                />
            </BarChart>
        </ResponsiveContainer>
    );
};

// Export the component so you can use it in QuizDifficultyAnalyzer.jsx
export default AnalysisBarGraph;