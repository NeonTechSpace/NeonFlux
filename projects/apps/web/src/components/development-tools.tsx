import { TanStackDevtools } from '@tanstack/react-devtools';
import { TanStackRouterDevtoolsPanel } from '@tanstack/react-router-devtools';

export default function DevelopmentTools() {
    return (
        <TanStackDevtools
            config={{
                position: 'bottom-right',
            }}
            plugins={[
                {
                    name: 'Tanstack Router',
                    render: <TanStackRouterDevtoolsPanel />,
                },
            ]}
        />
    );
}
